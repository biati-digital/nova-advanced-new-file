'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var escapeStringRegexp = string => {
	if (typeof string !== 'string') {
		throw new TypeError('Expected a string');
	}

	// Escape characters with special meaning either inside or outside character sets.
	// Use a simple backslash escape when it’s always valid, and a \unnnn escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
	return string
		.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
		.replace(/-/g, '\\x2d');
};

const regexpCache = new Map();

function makeRegexp(pattern, options) {
	options = {
		caseSensitive: false,
		...options
	};

	const cacheKey = pattern + JSON.stringify(options);

	if (regexpCache.has(cacheKey)) {
		return regexpCache.get(cacheKey);
	}

	const negated = pattern[0] === '!';

	if (negated) {
		pattern = pattern.slice(1);
	}

	pattern = escapeStringRegexp(pattern).replace(/\\\*/g, '[\\s\\S]*');

	const regexp = new RegExp(`^${pattern}$`, options.caseSensitive ? '' : 'i');
	regexp.negated = negated;
	regexpCache.set(cacheKey, regexp);

	return regexp;
}

var matcher = (inputs, patterns, options) => {
	if (!(Array.isArray(inputs) && Array.isArray(patterns))) {
		throw new TypeError(`Expected two arrays, got ${typeof inputs} ${typeof patterns}`);
	}

	if (patterns.length === 0) {
		return inputs;
	}

	const isFirstPatternNegated = patterns[0][0] === '!';

	patterns = patterns.map(pattern => makeRegexp(pattern, options));

	const result = [];

	for (const input of inputs) {
		// If first pattern is negated we include everything to match user expectation.
		let matches = isFirstPatternNegated;

		for (const pattern of patterns) {
			if (pattern.test(input)) {
				matches = !pattern.negated;
			}
		}

		if (matches) {
			result.push(input);
		}
	}

	return result;
};

var isMatch = (input, pattern, options) => {
	const inputArray = Array.isArray(input) ? input : [input];
	const patternArray = Array.isArray(pattern) ? pattern : [pattern];

	return inputArray.some(input => {
		return patternArray.every(pattern => {
			const regexp = makeRegexp(pattern, options);
			const matches = regexp.test(input);
			return regexp.negated ? !matches : matches;
		});
	});
};
matcher.isMatch = isMatch;

const options = {
    mode: '',
    ignoreHiddens: '',
    openafter: '',
    openall: '',
    cachelastfolder: '',
    log: '',
    ignore: '',
};

let cachedOptions = false;
let observing = false;

function observeOptionChange(options) {
    if (observing) {
        return false;
    }

    for (const key in options) {
        if (options.hasOwnProperty(key)) {
            const optionID = nova.extension.identifier + '.' + key;
            nova.config.onDidChange(optionID, (val) => {
                options[key] = val;
            });
        }
    }

    observing = true;
}

function extensionConfig() {
    if (cachedOptions) {
        return cachedOptions;
    }

    let extOptions = {};
    for (const key in options) {
        if (options.hasOwnProperty(key)) {
            const optionID = nova.extension.identifier + '.' + key;
            const opt = nova.config.get(optionID);
            extOptions[key] = opt;
        }
    }
    cachedOptions = extOptions;

    observeOptionChange(extOptions);

    return extOptions;
}

var config = extensionConfig;

function log(message, force) {
    const config$1 = config();
    if (nova.inDevMode() || config$1.log || force) {
        console.log(message);
    }
}

var helpers = {
    log,
};

const { log: log$1 } = helpers;
const settings = config();
const cache = new Map();
let cachedFolders = [];

/* Get Mode */
function getMode() {
    return settings.mode == 'Folder select' ? 'selector' : 'input';
}

/*
 * Check if ignore
 + when listing directories
 * we need to check if the path
 * is ignored
 */
function isPathIgnored(path, fileName) {
    path = path.replace(/^\/|\/$/g, '');

    if (settings.ignoreHiddens && fileName.startsWith('.')) {
        return true;
    }

    let ignored = settings.ignore;

    if (!ignored) {
        return false;
    }

    ignored = ignored.split('\n');
    let isIgnored = false;
    for (let el of ignored) {
        if (fileName === el || matcher.isMatch(path, el)) {
            isIgnored = true;
            return isIgnored;
        }
    }

    return isIgnored;
}

/*
 * List folders
 + list all the folders
 * inside the curren workspace
 */
function listWorkspaceFolders(path = '') {
    return new Promise((resolve) => {
        let foldersList = [];
        let workspaceFolders = [];

        const ignoredDefaultDirs = ['node_modules', '.git', '.svn', '.vscode', '.nova'];
        const command = ['find', '-L', path, '-type', 'd'];

        //log(`Wokspace path is ${path.replace(/([ "'$`\\])/g, '\\$1')}`);
        log$1(`Wokspace path is ${path}`);

        let userIgnoreDirs = settings.ignore.trim();

        if (userIgnoreDirs !== '') {
            userIgnoreDirs = userIgnoreDirs.split('\n');
        } else {
            userIgnoreDirs = ignoredDefaultDirs;
        }

        log$1('Ignore directories is set to:');
        log$1(userIgnoreDirs);

        if (userIgnoreDirs.length) {
            const totalIgnored = userIgnoreDirs.length;
            command.push('(');
            for (let i = 0; i < totalIgnored; i++) {
                command.push('-name');
                command.push(userIgnoreDirs[i]);

                if (i < totalIgnored - 1) {
                    command.push('-o');
                }
            }
            command.push(')');
            command.push('-prune');
            command.push('-o');
            command.push('-type');
            command.push('d');
        }

        command.push('-print');

        log$1('Generated command is');
        log$1(command.join(' '));

        const returnValue = {
            status: 0,
            stdout: [],
            stderr: [],
        };

        const findProcess = new Process('/usr/bin/env', {
            args: command,
        });

        findProcess.onStdout((l) => {
            returnValue.stdout.push(l.trim());
        });

        findProcess.onStderr((l) => {
            returnValue.stderr.push(l.trim());
        });

        findProcess.onDidExit((status) => {
            returnValue.status = status;
            log$1(`Find process status is ${status}`);

            if (status === 0) {
                //workspaceFolders = returnValue.stdout.join('\n');
                workspaceFolders = returnValue.stdout;
                for (let i = 0; i < workspaceFolders.length; i++) {
                    let fileRelative = workspaceFolders[i].replace(path, '');
                    let file = nova.path.basename(fileRelative);

                    if (!file) {
                        continue;
                    }

                    if (!fileRelative.startsWith('/')) {
                        fileRelative = `/${fileRelative}`;
                    }

                    if (!isPathIgnored(fileRelative, file)) {
                        foldersList.push(fileRelative);
                    }
                }

                foldersList = foldersList.sort((a, b) => {
                    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'case' });
                });

                log$1('All directories found in the workspace are: (Some exclusions might no be applied yet)');
                log$1(workspaceFolders.join('\n'));
                log$1('\n');
                log$1('Final list of directories is (this list should not include excluded paths)');
                log$1(foldersList.join('\n'));

                resolve(foldersList);
            } else {
                log$1(`There was an error with status ${status}`, true);
                log$1(returnValue.stderr, true);
                reject(status);
            }
        });

        try {
            log$1('Start find folders process');
            findProcess.start();
        } catch (e) {
            returnValue.status = 128;
            returnValue.stderr = [e.message];
            reject(returnValue);
        }
    });
}

/*
 * Process file creation
 + this function will process
 * the command and create
 * the correct paths of the file
 * to be created
 */
function processFileCreation(dir, file) {
    file = file.split(',');
    file = file.filter(Boolean);

    let created = [];
    let filesToCreate = file.length;

    file.forEach(async (f, i) => {
        const filePath = nova.path.join(nova.workspace.path, dir, f.trim());

        // If this is a folder
        if (f.endsWith('/')) {
            log$1(`creatin folder ${filePath}`);
            await makeSurePathExists(filePath);
            return;
        }

        const create = await createFile(filePath);

        if (create) {
            log$1(`created file ${filePath}`);
            created.push(filePath);
        } else {
            log$1(`Unable to create file ${filePath}`);
        }

        if (i + 1 == filesToCreate) {
            // If multiple created and configured to open all
            if (created.length > 1 && settings.openafter && settings.openall) {
                created.forEach((f) => nova.workspace.openFile(f)); //open all
                nova.workspace.openFile(created[0], []); // focus first file
            } else if (created.length > 0 && settings.openafter) {
                nova.workspace.openFile(created[0], []);
            }
        }
    });
}

/*
 * Create file
 * Actually create the file
 */
async function createFile(path = '') {
    await makeSurePathExists(path.split('/').slice(0, -1).join('/'));

    return new Promise((resolve) => {
        const file = nova.fs.open(path, 'x');
        file.close();
        resolve(true);
    });
}

/**
 * Make sure path exists
 */
async function makeSurePathExists(path = '') {
    return new Promise((resolve) => {
        const rootFolder = nova.workspace.path.split('/').pop();
        const folders = path.split('/');

        folders.reduce((acc, folder) => {
            const folderPath = nova.path.join(acc, folder);
            if (folderPath.includes('/' + rootFolder + '/')) {
                // Make sure folders (if any) exists before creting the file
                try {
                    nova.fs.mkdir(nova.path.join(folderPath));
                } catch (error) {}
            }
            return folderPath;
        });

        resolve(true);
    });
}

/*
 * Show input pallet
 * used to enter the file name or full path
 */
function showFileNameInputPallete(prependPath = '', message = '', placeholder = '') {
    nova.workspace.showInputPalette(message, { placeholder: placeholder }, (val) => {
        if (!val) {
            return;
        }
        processFileCreation(prependPath, val);
    });
}

/*
 * Show file path input pallet
 * used to enter the file full path
 * when selected mode is write path
 */
function showFilePathInputPallete() {
    nova.workspace.showInputPalette('', { placeholder: '' }, (val) => {
        if (!val) {
            return;
        }

        if (val.includes('/')) {
            const path = val.split('/');
            const last = path.pop();
            processFileCreation(path.join('/'), last);
            return;
        }

        processFileCreation('', val);
    });
}

/*
 * Show folder selector
 * display folders in current
 * workspace so we can easily filter
 * and select the folder where we want
 * to create our new file
 *
 */
async function showDirsSelectorPallete() {
    let initialPath = ['/'];
    let dirsList = [];
    let dirs = [];

    if (cachedFolders.length) {
        log$1('Loading folders list from cache');
        dirs = cachedFolders;
    } else {
        log$1('Generating folders list on the fly');
        dirs = await listWorkspaceFolders(nova.workspace.path);
    }

    if (!settings.cachelastfolder) {
        dirsList = initialPath.concat(dirs);
    }

    if (settings.cachelastfolder) {
        const lastDir = cache.get(nova.workspace.path + '_dir');
        if (lastDir && lastDir !== '/') {
            initialPath = [lastDir, '/'];
        }
        dirsList = [...new Set(initialPath.concat(dirs))];
    }

    nova.workspace.showChoicePalette(dirsList, { placeholder: '' }, (dir) => {
        if (!dir) {
            return;
        }
        if (dir) {
            if (settings.cachelastfolder) {
                cache.set(nova.workspace.path + '_dir', dir);
            }
            showFileNameInputPallete(dir, dir, 'File name');
        }
    });
}

/*
 * Register command
 */
nova.commands.register(nova.extension.identifier + '.new', () => {
    const mode = getMode();

    // If no workspace path, notify and stop
    if (!nova.workspace.path) {
        let request = new NotificationRequest('advancednewfile-notification');
        request.title = nova.localize('No Workspace found');
        request.body = nova.localize('First you need to create a new project or open an existing one to create files');
        request.actions = [nova.localize('OK')];
        nova.notifications.add(request);
        return false;
    }

    if (mode == 'selector') {
        showDirsSelectorPallete();
    }

    if (mode == 'input') {
        showFilePathInputPallete();
    }
});

var activate = () => {
    const mode = getMode();

    if (nova.workspace.path && mode == 'selector') {
        listWorkspaceFolders(nova.workspace.path).then((folders) => {
            cachedFolders = folders;
        });

        const watcherIgnore = ['node_modules', 'vendor', 'logs', '.next', '.git', '.svn'];

        nova.fs.watch(nova.workspace.path + '/*', (changed) => {
            let extension = nova.path.extname(changed);
            let isDir = false;
            let reIndex = false;

            try {
                isDir = nova.fs.stat(changed).isDirectory();
                reIndex = true;
            } catch (error) {
                // File probably was deleted, check it's name
                if (!extension) {
                    isDir = true;
                    reIndex = true;
                }
            }
            if (isDir) {
                log$1(`Workspace changed: ${changed}`);

                watcherIgnore.forEach((ignore) => {
                    if (changed.includes(ignore)) {
                        reIndex = false;
                    }
                });

                if (isPathIgnored(changed, '') || changed.includes('untitled folder')) {
                    reIndex = false;
                }

                if (!reIndex) {
                    log$1('Do not reindex as changed path is ignored');
                    return;
                }

                log$1('Reloading Folders List');
                listWorkspaceFolders(nova.workspace.path).then((folders) => {
                    cachedFolders = folders;
                });
            }
        });

        nova.workspace.onDidChangePath((path) => {
            log$1(`Workspace Path changed: ${changed}`);
            log$1('Reloading Folders List');
            listWorkspaceFolders(path).then((folders) => {
                cachedFolders = folders;
            });
        });
    }
};

var deactivate = () => {
    if (cache.has(nova.workspace.path + '_dir')) {
        cache.delete(nova.workspace.path + '_dir');
    }
    if (cache.has(nova.workspace.path + '_input')) {
        cache.delete(nova.workspace.path + '_input');
    }
};

var main = {
	activate: activate,
	deactivate: deactivate
};

exports.activate = activate;
exports.deactivate = deactivate;
exports.default = main;
