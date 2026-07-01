import { WorkflowState } from '../core/workflows/types.js';

export interface SteeringCommand {
  type: 'pause' | 'redirect' | 'inject_context' | 'override_tool';
  payload?: any;
}

export class SteeringController {
  private activeInterrupt: Promise<SteeringCommand> | null = null;
  private resolveInterrupt: ((cmd: SteeringCommand) => void) | null = null;

  /**
   * Pauses the workflow execution and waits for a steering command.
   */
  interrupt(): Promise<SteeringCommand> {
    if (this.activeInterrupt) {
      return this.activeInterrupt;
    }
    
    this.activeInterrupt = new Promise((resolve) => {
      this.resolveInterrupt = resolve;
    });
    
    return this.activeInterrupt;
  }

  /**
   * Resolves the interrupt with a specific steering command from the user.
   */
  dispatch(command: SteeringCommand) {
    if (this.resolveInterrupt) {
      this.resolveInterrupt(command);
      this.activeInterrupt = null;
      this.resolveInterrupt = null;
    }
  }

  /**
   * Called by the workflow executor to check for pending interrupts.
   * If an interrupt is triggered, it awaits user resolution before continuing.
   */
  async awaitIfInterrupted(state: WorkflowState): Promise<void> {
    if (this.activeInterrupt) {
      console.log(`\n\x1b[33m[Steering]\x1b[0m Workflow paused at node ${state.currentNodeId}. Awaiting instructions...`);
      const cmd = await this.activeInterrupt;
      console.log(`\n\x1b[32m[Steering]\x1b[0m Received command: ${cmd.type}`);
      
      if (cmd.type === 'redirect' && cmd.payload?.targetNode) {
        state.currentNodeId = cmd.payload.targetNode;
      } else if (cmd.type === 'inject_context') {
        state.context = { ...state.context, ...cmd.payload };
      }
    }
  }
}
