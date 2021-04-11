const matcher = require('matcher');
const extensionConfig = require('./config.js');
const { log } = require('./helpers.js');
const settings = extensionConfig();
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
        //const command = ['find', '-L', path.replace(/([ "'$`\\])/g, '\\$1'), '-type', 'd'];
        const command = ['find', '-L', path, '-type', 'd'];

        log(`Wokspace path is ${path.replace(/([ "'$`\\])/g, '\\$1')}`);

        let userIgnoreDirs = settings.ignore.trim();

        if (userIgnoreDirs !== '') {
            userIgnoreDirs = userIgnoreDirs.split('\n');
        } else {
            userIgnoreDirs = ignoredDefaultDirs;
        }

        log('Ignore directories is set to:');
        log(userIgnoreDirs);

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

        log('Generated command is');
        log(command.join(' '));

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
            log(`Find process status is ${status}`);

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

                log('All directories found in the workspace are: (Some exclusions might no be applied yet)');
                log(workspaceFolders.join('\n'));
                log('\n');
                log('Final list of directories is (this list should not include excluded paths)');
                log(foldersList.join('\n'));

                resolve(foldersList);
            } else {
                log(`There was an error with status ${status}`, true);
                log(returnValue.stderr, true);
                reject(status);
            }
        });

        try {
            log('Start find folders process');
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
        const create = await createFile(filePath);

        if (create) {
            log(`created file ${filePath}`);
            created.push(filePath);
        } else {
            log(`Unable to create file ${filePath}`);
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
    return new Promise((resolve) => {
        const rootFolder = nova.workspace.path.split('/').pop();
        const folders = path.split('/').slice(0, -1);

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

        const file = nova.fs.open(path, 'x');
        file.close();
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
        log('Loading folders list from cache');
        dirs = cachedFolders;
    } else {
        log('Generating folders list on the fly');
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

exports.activate = () => {
    const mode = getMode();

    if (nova.workspace.path && mode == 'selector') {
        listWorkspaceFolders(nova.workspace.path).then((folders) => {
            cachedFolders = folders;
        });

        nova.fs.watch(nova.workspace.path + '/*', (changed) => {
            let extension = nova.path.extname(changed);
            let isDir = false;

            try {
                isDir = nova.fs.stat(changed).isDirectory();
            } catch (error) {
                // File probably was deleted, check it's name
                if (!extension) {
                    isDir = true;
                }
            }
            if (isDir) {
                log(`Workspace changed: ${changed}`);
                log('Reloading Folders List');
                listWorkspaceFolders(nova.workspace.path).then((folders) => {
                    cachedFolders = folders;
                });
            }
        });

        nova.workspace.onDidChangePath((path) => {
            log(`Workspace Path changed: ${changed}`);
            log('Reloading Folders List');
            listWorkspaceFolders(path).then((folders) => {
                cachedFolders = folders;
            });
        });
    }
};

exports.deactivate = () => {
    if (cache.has(nova.workspace.path + '_dir')) {
        cache.delete(nova.workspace.path + '_dir');
    }
    if (cache.has(nova.workspace.path + '_input')) {
        cache.delete(nova.workspace.path + '_input');
    }
};
