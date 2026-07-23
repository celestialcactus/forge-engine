const ignoredWorkspaceDirectoryNames = new Set([
  '.git',
  '.forge',
  'dist',
  'node_modules',
  'target',
]);

export const isIgnoredWorkspaceDirectory = (name: string): boolean =>
  ignoredWorkspaceDirectoryNames.has(name);
