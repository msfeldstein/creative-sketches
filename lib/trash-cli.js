#!/usr/bin/env node
/**
 * CLI wrapper for trash utility
 * Usage: node lib/trash-cli.js <file1> [file2] [file3] ...
 */

import { moveToTrash } from './trash.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error('Usage: node lib/trash-cli.js <file1> [file2] [file3] ...');
  process.exit(1);
}

let errors = 0;

for (const file of files) {
  try {
    const filePath = resolve(process.cwd(), file);
    moveToTrash(filePath);
    console.log(`Moved to trash: ${file}`);
  } catch (error) {
    console.error(`Error trashing ${file}: ${error.message}`);
    errors++;
  }
}

process.exit(errors > 0 ? 1 : 0);
