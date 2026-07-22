import { TelemetryManager } from '../observability/telemetry.js';
import { CliRenderer } from '../observability/cli-renderer.js';
import { SteeringController } from './steer.js';

export class ForgeCLI {
  private telemetry: TelemetryManager;
  private renderer: CliRenderer;
  private steer: SteeringController;

  constructor() {
    this.telemetry = new TelemetryManager({ serviceName: 'forge-cli' });
    this.renderer = new CliRenderer();
    this.steer = new SteeringController();
  }

  async start() {
    this.telemetry.start();
    
    console.log('\x1b[35m=== Forge Engine CLI ===\x1b[0m');
    console.log('Type your instruction or hit Ctrl+C to exit.');
    console.log('Press Ctrl+Z at any time to trigger an interrupt and steer the agent.\n');

    // Setup interrupt listener for steering
    process.on('SIGTSTP', () => {
      this.steer.interrupt();
      
      // In a real CLI, we would prompt the user for the payload here using readline or inquirer.
      // For scaffolding, we just dispatch a pause.
      console.log('\n[!] Execution paused. Steer the agent (e.g., redirect node, inject context).');
      
      // Mock auto-resume for testing purposes
      setTimeout(() => {
        this.steer.dispatch({ type: 'redirect', payload: { targetNode: '__end__' } });
      }, 5000);
    });

    // Main CLI loop would go here
    this.renderer.startTask('init', 'Initializing Forge Engine...');
    
    // Simulating work
    setTimeout(() => {
      this.renderer.finishTask('init', 'Ready.');
    }, 1000);
  }

  async stop() {
    await this.telemetry.shutdown();
  }
}
