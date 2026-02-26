import chalk from 'chalk';
import ora from 'ora';
import { promises as fs } from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { FormData, File, Blob } from 'node-fetch';

interface ImportOptions {
  preset: string;
  api: string;
}

export async function importCommand(filePath: string, options: ImportOptions) {
  console.log(chalk.bold('\n📦 Importing Digital Twin\n'));

  // Validate file exists
  try {
    await fs.access(filePath);
  } catch {
    console.error(chalk.red(`❌ File not found: ${filePath}`));
    process.exit(1);
  }

  // Validate file extension
  const ext = path.extname(filePath).toLowerCase();
  if (!['.kml', '.geojson', '.json'].includes(ext)) {
    console.error(chalk.red(`❌ Unsupported file type: ${ext}`));
    console.log(chalk.gray('   Supported: .kml, .geojson, .json\n'));
    process.exit(1);
  }

  // Validate preset
  const validPresets = ['dehesa', 'mountain', 'mediterranean'];
  if (!validPresets.includes(options.preset)) {
    console.error(chalk.red(`❌ Invalid preset: ${options.preset}`));
    console.log(chalk.gray(`   Valid presets: ${validPresets.join(', ')}\n`));
    process.exit(1);
  }

  console.log(chalk.gray(`  File: ${path.basename(filePath)}`));
  console.log(chalk.gray(`  Preset: ${options.preset}`));
  console.log(chalk.gray(`  API: ${options.api}\n`));

  const spinner = ora('Uploading file...').start();

  try {
    // Read file
    const fileBuffer = await fs.readFile(filePath);
    const fileName = path.basename(filePath);

    // Create multipart form data
    const formData = new FormData() as any;
    formData.append('file', fileBuffer, {
      filename: fileName,
      contentType: ext === '.kml' ? 'application/vnd.google-earth.kml+xml' : 'application/json',
    });
    formData.append('preset', options.preset);

    spinner.text = 'Uploading to API...';

    // Upload to API
    const response = await fetch(`${options.api}/api/import`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json() as any;
    
    spinner.text = 'Parsing geometry...';

    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 500));

    spinner.succeed(chalk.green('✓ Digital Twin created successfully!'));

    // Display results
    console.log(chalk.bold('\n📊 Twin Details:'));
    console.log(chalk.gray(`  ID: ${result.twinId || 'N/A'}`));
    console.log(chalk.gray(`  Area: ${result.area_ha ? result.area_ha.toFixed(2) : 'N/A'} ha`));
    console.log(chalk.gray(`  Center: ${result.centroid ? result.centroid.join(', ') : 'N/A'}`));
    console.log(chalk.gray(`  Preset: ${result.preset || options.preset}`));

    console.log(chalk.bold('\n🌍 Open in browser:'));
    console.log(chalk.cyan(`  http://localhost:3000/?twin=${result.twinId || 'default'}`));

    console.log(chalk.bold('\n💡 Tip:'));
    console.log(chalk.gray('  Make sure web and API servers are running: geotwin dev\n'));
  } catch (error) {
    spinner.fail(chalk.red('Failed to import twin'));
    
    if (error instanceof Error) {
      console.error(chalk.red(`  Error: ${error.message}`));
    }
    
    console.log(chalk.gray('\n  Troubleshooting:'));
    console.log(chalk.gray(`  - Is the API running? Check: ${options.api}/health`));
    console.log(chalk.gray('  - Run: geotwin dev (to start servers)\n'));
    
    process.exit(1);
  }
}
