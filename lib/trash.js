/**
 * Cross-platform trash utility
 * Moves files to the system trash instead of hard deleting them
 * 
 * Supports:
 * - Linux (FreeDesktop.org Trash specification)
 * - macOS (~/.Trash)
 * - Windows (Recycle Bin via shell)
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';

/**
 * Get the trash directory path for the current platform
 * @returns {string} Path to trash directory
 */
function getTrashPath() {
  const platform = process.platform;
  
  if (platform === 'darwin') {
    // macOS
    return join(homedir(), '.Trash');
  } else if (platform === 'win32') {
    // Windows - we'll use PowerShell to move to Recycle Bin
    return null; // Special handling for Windows
  } else {
    // Linux and other Unix-like systems (FreeDesktop.org spec)
    const xdgDataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
    return join(xdgDataHome, 'Trash', 'files');
  }
}

/**
 * Get the trash info directory path (for Linux)
 * @returns {string} Path to trash info directory
 */
function getTrashInfoPath() {
  const platform = process.platform;
  
  if (platform === 'win32' || platform === 'darwin') {
    return null; // Not needed for Windows/macOS
  }
  
  // Linux - FreeDesktop.org spec
  const xdgDataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(xdgDataHome, 'Trash', 'info');
}

/**
 * Generate a unique filename in trash (adds number suffix if file exists)
 * @param {string} trashDir - Trash directory path
 * @param {string} filename - Original filename
 * @returns {string} Unique filename in trash
 */
function getUniqueTrashName(trashDir, filename) {
  let counter = 0;
  let baseName = filename;
  let ext = '';
  const lastDot = filename.lastIndexOf('.');
  
  if (lastDot > 0) {
    baseName = filename.substring(0, lastDot);
    ext = filename.substring(lastDot);
  }
  
  let trashName = filename;
  while (existsSync(join(trashDir, trashName))) {
    counter++;
    trashName = `${baseName} ${counter}${ext}`;
  }
  
  return trashName;
}

/**
 * Create trash info file for Linux (FreeDesktop.org spec)
 * @param {string} infoPath - Path where info file should be created
 * @param {string} originalPath - Original absolute path of the file
 * @param {string} trashName - Name of file in trash
 */
function createTrashInfo(infoPath, originalPath, trashName) {
  const now = new Date();
  const deletionDate = now.toISOString().split('T')[0] + 'T' + 
                       now.toTimeString().split(' ')[0];
  
  const infoContent = `[Trash Info]
Path=${originalPath}
DeletionDate=${deletionDate}
`;
  
  const infoFilename = trashName + '.trashinfo';
  writeFileSync(join(infoPath, infoFilename), infoContent, 'utf8');
}

/**
 * Move a file to trash (cross-platform)
 * @param {string} filePath - Path to the file to trash
 * @throws {Error} If file doesn't exist or can't be moved
 */
export function moveToTrash(filePath) {
  // Resolve absolute path
  const absolutePath = resolve(filePath);
  
  // Check if file exists
  if (!existsSync(absolutePath)) {
    throw new Error(`File does not exist: ${absolutePath}`);
  }
  
  const platform = process.platform;
  const filename = basename(absolutePath);
  
  if (platform === 'win32') {
    // Windows: Use PowerShell to move to Recycle Bin
    try {
      // PowerShell command to move to Recycle Bin
      const psCommand = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${absolutePath.replace(/'/g, "''")}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;
      execFileSync('powershell', ['-Command', psCommand], { stdio: 'ignore' });
    } catch (error) {
      // Fallback: try using cmd with del command (but this doesn't go to recycle bin)
      // Actually, let's just throw the error - we want proper trash behavior
      throw new Error(`Failed to move file to Recycle Bin: ${error.message}`);
    }
  } else {
    // macOS and Linux
    const trashDir = getTrashPath();
    
    // Ensure trash directory exists
    if (!existsSync(trashDir)) {
      mkdirSync(trashDir, { recursive: true });
    }
    
    // Get unique name in trash
    const trashName = getUniqueTrashName(trashDir, filename);
    const trashFilePath = join(trashDir, trashName);
    
    // Move file to trash
    renameSync(absolutePath, trashFilePath);
    
    // Create trash info file for Linux (FreeDesktop.org spec)
    if (platform !== 'darwin') {
      const infoPath = getTrashInfoPath();
      if (infoPath) {
        if (!existsSync(infoPath)) {
          mkdirSync(infoPath, { recursive: true });
        }
        createTrashInfo(infoPath, absolutePath, trashName);
      }
    }
  }
}
