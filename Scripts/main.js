const matcher = require('matcher');
const extensionConfig = require('./config.js');
const { log } = require('./helpers.js');
const settings = extensionConfig();
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
            log(`created file ${filePath}`);
            created.push(filePath);
        } else {
            log(`Unable to create file ${filePath}`);
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

exports.activate = () => {};

exports.deactivate = () => {
    if (cache.has(nova.workspace.path + '_dir')) {
        cache.delete(nova.workspace.path + '_dir');
    }
    if (cache.has(nova.workspace.path + '_input')) {
        cache.delete(nova.workspace.path + '_input');
    }
};
