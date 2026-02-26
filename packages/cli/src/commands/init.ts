import chalk from 'chalk';
import inquirer from 'inquirer';
import { promises as fs } from 'fs';
import path from 'path';
import ora from 'ora';

const ENV_WEB_TEMPLATE = `# ==================================================
# GEOTWIN WEB FRONTEND - ENVIRONMENT VARIABLES
# ==================================================

# Cesium Ion Access Token
# Get your token from: https://ion.cesium.com/tokens
# Required for: World Terrain (high-resolution DEM), Bing Maps imagery, Ion assets
NEXT_PUBLIC_CESIUM_ION_TOKEN={{CESIUM_TOKEN}}

# API Base URL
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001

# Development Mode
NODE_ENV=development
`;

const ENV_API_TEMPLATE = `# ==================================================
# GEOTWIN API - ENVIRONMENT VARIABLES
# ==================================================

# Server Configuration
PORT=3001
API_PORT=3001
HOST=0.0.0.0

# ==================================================
# Copernicus / Sentinel Hub Configuration
# ==================================================
# For Real NDVI with Sentinel-2 imagery
# Register at: https://dataspace.copernicus.eu/
COPERNICUS_CLIENT_ID={{COPERNICUS_CLIENT_ID}}
COPERNICUS_CLIENT_SECRET={{COPERNICUS_CLIENT_SECRET}}

# ==================================================
# Node Environment
# ==================================================
NODE_ENV=development
LOG_LEVEL=info
`;

export async function initCommand() {
  console.log(chalk.bold('\n📝 GeoTwin Initialization Wizard\n'));
  console.log(chalk.gray('This will create .env files with your credentials.\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'cesiumToken',
      message: 'Cesium Ion Access Token (get from https://ion.cesium.com/tokens):',
      default: 'your_cesium_ion_token_here',
    },
    {
      type: 'confirm',
      name: 'setupCopernicus',
      message: 'Do you want to configure Copernicus/Sentinel for real NDVI?',
      default: false,
    },
  ]);

  let copernicusClientId = 'your_copernicus_client_id';
  let copernicusClientSecret = 'your_copernicus_client_secret';

  if (answers.setupCopernicus) {
    const copernicusAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'clientId',
        message: 'Copernicus Client ID:',
        default: 'your_copernicus_client_id',
      },
      {
        type: 'input',
        name: 'clientSecret',
        message: 'Copernicus Client Secret:',
        default: 'your_copernicus_client_secret',
      },
    ]);

    copernicusClientId = copernicusAnswers.clientId;
    copernicusClientSecret = copernicusAnswers.clientSecret;
  }

  const spinner = ora('Creating .env files...').start();

  try {
    // Detect monorepo structure
    const cwd = process.cwd();
    const webEnvPath = path.join(cwd, 'apps', 'web', '.env');
    const apiEnvPath = path.join(cwd, 'apps', 'api', '.env');

    // Create web .env
    const webEnv = ENV_WEB_TEMPLATE.replace('{{CESIUM_TOKEN}}', answers.cesiumToken);
    await fs.writeFile(webEnvPath, webEnv, 'utf-8');
    spinner.text = 'Created apps/web/.env';

    // Create API .env
    const apiEnv = ENV_API_TEMPLATE
      .replace('{{COPERNICUS_CLIENT_ID}}', copernicusClientId)
      .replace('{{COPERNICUS_CLIENT_SECRET}}', copernicusClientSecret);
    await fs.writeFile(apiEnvPath, apiEnv, 'utf-8');
    
    spinner.succeed(chalk.green('✓ Environment files created successfully!'));

    console.log(chalk.bold('\n📂 Created files:'));
    console.log(chalk.gray(`  - ${webEnvPath}`));
    console.log(chalk.gray(`  - ${apiEnvPath}`));

    console.log(chalk.bold('\n🚀 Next steps:'));
    console.log(chalk.cyan('  1. Edit .env files with your actual credentials'));
    console.log(chalk.cyan('  2. Run: geotwin dev'));
    console.log(chalk.cyan('  3. Run: geotwin import <file.kml> --preset dehesa\n'));
  } catch (error) {
    spinner.fail(chalk.red('Failed to create .env files'));
    console.error(error);
    process.exit(1);
  }
}
