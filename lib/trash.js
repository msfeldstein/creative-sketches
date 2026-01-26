/**
 * Cross-platform trash utility
 * Moves files to system trash instead of permanent deletion
 * 
 * Works on:
 * - macOS: Uses Finder via osascript
 * - Linux: Uses XDG Trash spec (~/.local/share/Trash/)
 * - Windows: Uses PowerShell with Shell.Application
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync, statSync } from 'fs';
import { join, basename, resolve } from 'path';
import { homedir } from 'os';

/**
 * Move a file or directory to the system trash
 * @param {string} filePath - Path to the file or directory to trash
 * @throws {Error} If the file doesn't exist or trashing fails
 */
export function trash(filePath) {
  const absolutePath = resolve(filePath);
  
  if (!existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }
  
  const platform = process.platform;
  
  if (platform === 'darwin') {
    trashMacOS(absolutePath);
  } else if (platform === 'win32') {
    trashWindows(absolutePath);
  } else {
    // Linux and other Unix-like systems
    trashLinux(absolutePath);
  }
}

/**
 * macOS: Use Finder via osascript
 */
function trashMacOS(filePath) {
  // AppleScript to move file to trash via Finder
  const script = `
    tell application "Finder"
      delete POSIX file "${filePath.replace(/"/g, '\\"')}"
    end tell
  `;
  
  try {
    execFileSync('osascript', ['-e', script], { stdio: 'pipe' });
  } catch (err) {
    throw new Error(`Failed to trash file on macOS: ${err.message}`);
  }
}

/**
 * Windows: Use PowerShell with Shell.Application
 */
function trashWindows(filePath) {
  // PowerShell script to move to Recycle Bin
  const script = `
    $shell = New-Object -ComObject Shell.Application
    $item = $shell.NameSpace(0).ParseName("${filePath.replace(/"/g, '`"')}")
    if ($item) {
      $item.InvokeVerb("delete")
    } else {
      throw "File not found"
    }
  `;
  
  try {
    execFileSync('powershell', ['-Command', script], { stdio: 'pipe' });
  } catch (err) {
    throw new Error(`Failed to trash file on Windows: ${err.message}`);
  }
}

/**
 * Linux: Use XDG Trash specification
 * https://specifications.freedesktop.org/trash-spec/trashspec-latest.html
 */
function trashLinux(filePath) {
  const trashDir = join(homedir(), '.local', 'share', 'Trash');
  const filesDir = join(trashDir, 'files');
  const infoDir = join(trashDir, 'info');
  
  // Ensure trash directories exist
  mkdirSync(filesDir, { recursive: true });
  mkdirSync(infoDir, { recursive: true });
  
  const fileName = basename(filePath);
  let destName = fileName;
  let destPath = join(filesDir, destName);
  
  // Handle name collisions by appending a number
  let counter = 1;
  while (existsSync(destPath)) {
    const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
    const base = ext ? fileName.slice(0, -ext.length) : fileName;
    destName = `${base}.${counter}${ext}`;
    destPath = join(filesDir, destName);
    counter++;
  }
  
  // Create .trashinfo metadata file
  const deletionDate = new Date().toISOString().replace(/\.\d{3}Z$/, '');
  const trashInfo = `[Trash Info]
Path=${filePath}
DeletionDate=${deletionDate}
`;
  
  const infoPath = join(infoDir, destName + '.trashinfo');
  
  try {
    // Write metadata first
    writeFileSync(infoPath, trashInfo);
    // Then move the file
    renameSync(filePath, destPath);
  } catch (err) {
    throw new Error(`Failed to trash file on Linux: ${err.message}`);
  }
}

export default trash;
