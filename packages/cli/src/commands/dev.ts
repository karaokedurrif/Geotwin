import chalk from 'chalk';
import { spawn } from 'child_process';
import ora from 'ora';

interface DevOptions {
  webPort: string;
  apiPort: string;
}

export async function devCommand(options: DevOptions) {
  console.log(chalk.bold('\n🚀 Starting GeoTwin Development Servers\n'));

  const spinner = ora('Initializing...').start();

  try {
    // Detect if we're in the monorepo root
    const cwd = process.cwd();
    
    spinner.text = 'Starting API server...';
    
    // Start API server
    const api = spawn('pnpm', ['--filter', '@geotwin/api', 'dev'], {
      cwd,
      shell: true,
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: options.apiPort,
        API_PORT: options.apiPort,
      },
    });

    api.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes('running')) {
        console.log(chalk.green(`  ✓ API: ${output.trim()}`));
      }
    });

    api.stderr?.on('data', (data) => {
      console.error(chalk.red(`  API Error: ${data.toString()}`));
    });

    // Wait a bit for API to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    spinner.text = 'Starting web server...';

    // Start Web server
    const web = spawn('pnpm', ['--filter', '@geotwin/web', 'dev'], {
      cwd,
      shell: true,
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: options.webPort,
      },
    });

    web.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes('ready') || output.includes('Ready')) {
        console.log(chalk.green(`  ✓ Web: ${output.trim()}`));
      }
    });

    web.stderr?.on('data', (data) => {
      const errors = data.toString();
      // Filter out webpack warnings
      if (!errors.includes('webpack') && !errors.includes('wait') && errors.trim()) {
        console.error(chalk.yellow(`  Web: ${errors.trim()}`));
      }
    });

    spinner.succeed(chalk.green('Servers starting...\n'));

    console.log(chalk.bold('📍 Servers:'));
    console.log(chalk.cyan(`  Web:    http://localhost:${options.webPort}`));
    console.log(chalk.cyan(`  API:    http://localhost:${options.apiPort}`));
    console.log(chalk.cyan(`  Health: http://localhost:${options.apiPort}/health\n`));

    console.log(chalk.gray('Press Ctrl+C to stop servers\n'));

    // Handle cleanup on exit
    const cleanup = () => {
      console.log(chalk.yellow('\n\n🛑 Shutting down servers...'));
      api.kill();
      web.kill();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    spinner.fail(chalk.red('Failed to start servers'));
    
    if (error instanceof Error) {
      console.error(chalk.red(`  Error: ${error.message}`));
    }

    console.log(chalk.gray('\n  Troubleshooting:'));
    console.log(chalk.gray('  - Are you in the monorepo root directory?'));
    console.log(chalk.gray('  - Run: pnpm install (to install dependencies)\n'));
    
    process.exit(1);
  }
}
