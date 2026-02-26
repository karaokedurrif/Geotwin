#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { importCommand } from './commands/import.js';
import { devCommand } from './commands/dev.js';

const program = new Command();

program
  .name('geotwin')
  .description(chalk.cyan('GeoTwin CLI - Create interactive 3D geospatial digital twins'))
  .version('0.1.0');

// Init command
program
  .command('init')
  .description('Initialize GeoTwin configuration (.env files)')
  .action(initCommand);

// Import command
program
  .command('import <file>')
  .description('Import a KML/GeoJSON file and create a digital twin')
  .option('-p, --preset <preset>', 'Visual preset: dehesa, mountain, mediterranean', 'dehesa')
  .option('-a, --api <url>', 'API base URL', 'http://localhost:3001')
  .action(importCommand);

// Dev command
program
  .command('dev')
  .description('Start web and API servers in development mode')
  .option('--web-port <port>', 'Web server port', '3000')
  .option('--api-port <port>', 'API server port', '3001')
  .action(devCommand);

// Show banner
console.log(chalk.cyan.bold('\n╔══════════════════════════════════╗'));
console.log(chalk.cyan.bold('║       🌍 GeoTwin CLI v0.1       ║'));
console.log(chalk.cyan.bold('╚══════════════════════════════════╝\n'));

program.parse();
