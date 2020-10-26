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

function getMode() {
    return settings.mode == 'Folder select' ? 'selector' : 'input';
}

/*
 * Check if ignore
 + when listing directories
 * we need to check if the path
 * is ignored
 */
function isPathIgnored(path) {
    path = path.replace(/^\/|\/$/g, '');

    if (settings.ignoreHiddens && path.startsWith('.')) {
        return true;
    }

    let ignored = settings.ignore;

    if (!ignored) {
        return false;
    }

    ignored = ignored.split('\n');
    let isIgnored = false;
    for (let el of ignored) {
        let matchIgnore = matcher.isMatch(path, el);
        //log(`Should ignore ${path}, testing with ${el} and result is ${matchIgnore}`);

        if (matchIgnore) {
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
    let list = [];

    try {
        const filesInDir = nova.fs.listdir(path);

        filesInDir.forEach((file) => {
            const filePath = nova.path.join(path, file);
            const stat = nova.fs.stat(filePath);

            if (stat.isDirectory()) {
                let fileRelative = nova.path.join(path.replace(nova.workspace.path, ''), file);
                if (!fileRelative.startsWith('/')) {
                    fileRelative = `/${fileRelative}`;
                }

                if (!isPathIgnored(fileRelative)) {
                    let innerFolders = listWorkspaceFolders(filePath);
                    list.push(fileRelative);
                    if (innerFolders.length) {
                        list = list.concat(innerFolders);
                    }
                }
            }
        });
    } catch (error) {
        console.error(error);
    }

    return list;
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
                nova.workspace.openFile(created[0]); // focus first file
            } else if (created.length > 0 && settings.openafter) {
                nova.workspace.openFile(created[0]);
            }
        }
    });
}

/*
 * Create file
 * Actually create the file
 */
async function createFile(path = '') {
    return new Promise((resolve, reject) => {
        const relPath = nova.workspace.relativizePath(path);
        const rootFolder = nova.workspace.path.split('/').pop();
        const folders = path.split('/').slice(0, -1);

        folders.reduce((acc, folder) => {
            const folderPath = nova.path.join(acc, folder);
            if (folderPath.includes('/' + rootFolder + '/')) {
                // Make sure folders (if any) exists before creting the file
                try {
                    nova.fs.mkdir(nova.path.join(folderPath));
                } catch (error) {
                }
            }
            return folderPath;
        });

        const file = nova.fs.open(path, 'x');
        file.close();
        resolve(true);
    });
}

/*
 * Show input pallet
 * used to enter the file name or full path
 */
async function showFileNameInputPallete(prependPath = '', message = '', placeholder = '') {
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
 */
async function showFilePathInputPallete(message = '', placeholder = '') {
    nova.workspace.showInputPalette(message, { placeholder: placeholder }, (val) => {
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

    if (settings.cachelastfolder) {
        const lastDir = cache.get(nova.workspace.path + '_dir');
        if (lastDir && lastDir !== '/') {
            initialPath = [lastDir, '/'];
        }
    }

    const index = await new Promise((resolve, reject) => {
        const dirs = listWorkspaceFolders(nova.workspace.path);
        nova.workspace.showChoicePalette(initialPath.concat(dirs), { placeholder: '' }, (dir, index) => {
            if (!dir) {
                resolve(dirs);
            }
            if (dir) {
                if (settings.cachelastfolder) {
                    cache.set(nova.workspace.path + '_dir', dir);
                }
                showFileNameInputPallete(dir, dir, 'File name');
            }
        });
    });
}

/*
 * Register command
 */
nova.commands.register(nova.extension.identifier + '.new', (editor) => {
    const mode = getMode();

    if (mode == 'selector') {
        showDirsSelectorPallete();
    }

    if (mode == 'input') {
        showFilePathInputPallete('', '');
    }
});

var activate = () => {};

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
