export class CliRenderer {
  private activeTasks = new Map<string, string>();
  private lastRender = 0;

  startTask(id: string, description: string) {
    this.activeTasks.set(id, description);
    this.render();
  }

  updateTask(id: string, description: string) {
    if (this.activeTasks.has(id)) {
      this.activeTasks.set(id, description);
      this.render();
    }
  }

  finishTask(id: string, result: string, isError = false) {
    this.activeTasks.delete(id);
    this.clearLine();
    process.stdout.write(`${isError ? '❌' : '✅'} ${result}\n`);
    this.render();
  }

  streamThought(agentName: string, text: string) {
    this.clearLine();
    process.stdout.write(`\x1b[36m[${agentName} Thinking]\x1b[0m: ${text}\n`);
    this.render();
  }

  private render() {
    const now = Date.now();
    if (now - this.lastRender < 100) return; // throttle

    this.clearLine();
    if (this.activeTasks.size > 0) {
      const active = Array.from(this.activeTasks.values());
      process.stdout.write(`⏳ \x1b[33m${active[0]}\x1b[0m ${active.length > 1 ? `(+${active.length - 1} tasks)` : ''}`);
    }
    this.lastRender = now;
  }

  private clearLine() {
    process.stdout.write('\x1b[2K\r');
  }
}
