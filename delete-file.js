const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pathToFileURL } = require('url');

const execFileAsync = promisify(execFile);

async function moveToTrash(targetPath) {
  if (!targetPath) {
    throw new Error('Target path is required.');
  }

  const absolutePath = path.resolve(targetPath);
  const stats = await fs.lstat(absolutePath);

  if (process.platform === 'win32') {
    await moveToTrashWindows(absolutePath, stats.isDirectory());
    return { trashedPath: null };
  }

  if (process.platform === 'darwin') {
    return moveToTrashMac(absolutePath, stats);
  }

  return moveToTrashLinux(absolutePath, stats);
}

async function moveToTrashMac(absolutePath, stats) {
  const trashDir = path.join(os.homedir(), '.Trash');
  await fs.mkdir(trashDir, { recursive: true });
  const { name, fullPath } = await getUniqueTrashPath(trashDir, path.basename(absolutePath));
  await moveItem(absolutePath, fullPath, stats);
  return { trashedPath: fullPath, trashedName: name };
}

async function moveToTrashLinux(absolutePath, stats) {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const trashDir = path.join(dataHome, 'Trash');
  const filesDir = path.join(trashDir, 'files');
  const infoDir = path.join(trashDir, 'info');

  await fs.mkdir(filesDir, { recursive: true });
  await fs.mkdir(infoDir, { recursive: true });

  const { name, fullPath } = await getUniqueTrashPath(filesDir, path.basename(absolutePath));
  await moveItem(absolutePath, fullPath, stats);

  const infoPath = path.join(infoDir, `${name}.trashinfo`);
  const infoContents = [
    '[Trash Info]',
    `Path=${encodeTrashPath(absolutePath)}`,
    `DeletionDate=${formatDeletionDate(new Date())}`,
    ''
  ].join('\n');
  await fs.writeFile(infoPath, infoContents, 'utf8');

  return { trashedPath: fullPath, trashedName: name };
}

async function moveToTrashWindows(absolutePath, isDirectory) {
  const escapedPath = absolutePath.replace(/'/g, "''");
  const deleteMethod = isDirectory ? 'DeleteDirectory' : 'DeleteFile';
  const script = [
    'Add-Type -AssemblyName Microsoft.VisualBasic;',
    `$path = '${escapedPath}';`,
    `[Microsoft.VisualBasic.FileIO.FileSystem]::${deleteMethod}(` +
      '$path, "OnlyErrorDialogs", "SendToRecycleBin");'
  ].join(' ');

  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
}

async function getUniqueTrashPath(dir, baseName) {
  let counter = 0;
  const ext = path.extname(baseName);
  const base = path.basename(baseName, ext);

  while (true) {
    const suffix = counter === 0 ? '' : `-${counter}`;
    const name = `${base}${suffix}${ext}`;
    const fullPath = path.join(dir, name);
    try {
      await fs.access(fullPath);
      counter += 1;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { name, fullPath };
      }
      throw error;
    }
  }
}

async function moveItem(source, destination, stats) {
  try {
    await fs.rename(source, destination);
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }
    if (stats.isDirectory()) {
      await fs.cp(source, destination, { recursive: true });
      await fs.rm(source, { recursive: true, force: true });
    } else {
      await fs.copyFile(source, destination);
      await fs.unlink(source);
    }
  }
}

function encodeTrashPath(absolutePath) {
  return pathToFileURL(absolutePath).pathname;
}

function formatDeletionDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + 'T' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(':');
}

async function runCli() {
  const targetPath = process.argv[2];
  if (!targetPath) {
    console.error('Usage: node delete-file.js <path>');
    process.exit(1);
  }

  try {
    const result = await moveToTrash(targetPath);
    if (result?.trashedPath) {
      console.log(result.trashedPath);
    }
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = { moveToTrash };
