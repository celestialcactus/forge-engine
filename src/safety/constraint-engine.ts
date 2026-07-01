import fs from 'node:fs';
import path from 'node:path';

/**
 * Constraint Engine — machine-enforced boundaries that cannot be bypassed via prompting.
 *
 * Checks:
 * - Allowed/blocked file paths
 * - Dependency file modification detection
 * - Command allow/deny list
 */
export interface ConstraintViolation {
  type: 'blocked_path' | 'dependency_modification' | 'blocked_command' | 'api_boundary';
  message: string;
  path?: string;
  command?: string;
}

export interface ConstraintEngineConfig {
  forbiddenPaths: string[];
  dependencyFiles: string[];
  blockedCommands: string[];
  allowedCommands?: string[];
}

const DEFAULT_FORBIDDEN_PATHS = [
  '.git',
  'node_modules',
  '.env',
  'secrets',
  '.ssh',
  '.aws',
];

const DEFAULT_DEPENDENCY_FILES = [
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'requirements.txt',
  'Pipfile',
  'Pipfile.lock',
  'pyproject.toml',
  'poetry.lock',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Cargo.lock',
];

const DEFAULT_BLOCKED_COMMANDS = [
  'rm -rf',
  'rm -r /',
  'format',
  'mkfs',
  'dd if=',
  'DROP DATABASE',
  'DROP TABLE',
  'TRUNCATE',
  'shutdown',
  'reboot',
  ':(){:|:&};:',
];

export class ConstraintEngine {
  private config: ConstraintEngineConfig;
  private repoRoot: string;

  constructor(repoRoot: string, config?: Partial<ConstraintEngineConfig>) {
    this.repoRoot = path.resolve(repoRoot);
    this.config = {
      forbiddenPaths: [
        ...DEFAULT_FORBIDDEN_PATHS,
        ...(config?.forbiddenPaths || []),
      ],
      dependencyFiles: [
        ...DEFAULT_DEPENDENCY_FILES,
        ...(config?.dependencyFiles || []),
      ],
      blockedCommands: [
        ...DEFAULT_BLOCKED_COMMANDS,
        ...(config?.blockedCommands || []),
      ],
      allowedCommands: config?.allowedCommands,
    };
  }

  /**
   * Load additional forbidden paths from REPO_PROFILE.md
   */
  loadFromRepoProfile(): void {
    const profilePath = path.join(this.repoRoot, '.agent', 'REPO_PROFILE.md');
    if (!fs.existsSync(profilePath)) return;

    const content = fs.readFileSync(profilePath, 'utf-8');
    const forbiddenSection = content.match(
      /## Forbidden Areas\n([\s\S]*?)(?=\n## |$)/,
    );
    if (forbiddenSection && forbiddenSection[1]) {
      const paths = forbiddenSection[1]
        .split('\n')
        .map((line) => line.replace(/^- /, '').trim().replace(/\/$/, ''))
        .filter(Boolean);
      this.config.forbiddenPaths.push(...paths);
    }
  }

  /**
   * Check if a file path is allowed for writing.
   */
  validateFilePath(filePath: string): ConstraintViolation | null {
    const normalizedPath = path.resolve(filePath);
    const relativePath = path.relative(this.repoRoot, normalizedPath);

    // Check if path is within repo
    if (relativePath.startsWith('..')) {
      return {
        type: 'blocked_path',
        message: `Path is outside the repository root: ${filePath}`,
        path: filePath,
      };
    }

    // Check forbidden paths
    for (const forbidden of this.config.forbiddenPaths) {
      if (
        relativePath.startsWith(forbidden) ||
        relativePath.includes(`/${forbidden}/`) ||
        relativePath.includes(`\\${forbidden}\\`)
      ) {
        return {
          type: 'blocked_path',
          message: `Path is in a forbidden area: ${forbidden}`,
          path: filePath,
        };
      }
    }

    return null;
  }

  /**
   * Check if a file is a dependency file (requires special approval).
   */
  isDependencyFile(filePath: string): ConstraintViolation | null {
    const basename = path.basename(filePath);
    if (this.config.dependencyFiles.includes(basename)) {
      return {
        type: 'dependency_modification',
        message: `Modifying dependency file requires explicit approval: ${basename}`,
        path: filePath,
      };
    }
    return null;
  }

  /**
   * Check if a command is allowed.
   */
  validateCommand(command: string): ConstraintViolation | null {
    const normalizedCmd = command.toLowerCase().trim();

    // Check blocked commands
    for (const blocked of this.config.blockedCommands) {
      if (normalizedCmd.includes(blocked.toLowerCase())) {
        return {
          type: 'blocked_command',
          message: `Command contains blocked pattern: "${blocked}"`,
          command,
        };
      }
    }

    // If allowlist exists, check it
    if (this.config.allowedCommands) {
      const isAllowed = this.config.allowedCommands.some((allowed) =>
        normalizedCmd.startsWith(allowed.toLowerCase()),
      );
      if (!isAllowed) {
        return {
          type: 'blocked_command',
          message: `Command not in allowlist: "${command}"`,
          command,
        };
      }
    }

    return null;
  }

  /**
   * Validate a batch of file paths (for patch validation).
   */
  validatePatchTargets(filePaths: string[]): ConstraintViolation[] {
    const violations: ConstraintViolation[] = [];
    for (const fp of filePaths) {
      const pathViolation = this.validateFilePath(fp);
      if (pathViolation) violations.push(pathViolation);

      const depViolation = this.isDependencyFile(fp);
      if (depViolation) violations.push(depViolation);
    }
    return violations;
  }
}
