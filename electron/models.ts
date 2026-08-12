import { readdir, stat } from 'node:fs/promises';
import * as fs from 'node:fs';
import path from 'node:path';
import chokidar, { FSWatcher } from 'chokidar';
import type { GgufModel } from '../src/types';
import { describeUnavailableGguf, inspectGguf } from './gguf';

async function collectGgufFiles(directory: string, depth = 0): Promise<string[]> {
  if (depth > 6) return [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();

    if (entry.isSymbolicLink()) {
      try {
        const s = fs.statSync(fullPath);
        isDirectory = s.isDirectory();
        isFile = s.isFile();
      } catch {
        continue;
      }
    }

    if (isDirectory) {
      if (!entry.name.startsWith('.')) {
        files.push(...(await collectGgufFiles(fullPath, depth + 1)));
      }
    } else if (
      isFile &&
      (entry.name.toLowerCase().endsWith('.gguf') ||
        entry.name.toLowerCase().endsWith('.gguf.partial'))
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function scanModelPaths(paths: string[]): Promise<GgufModel[]> {
  const files = new Set<string>();
  for (const candidate of paths) {
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) {
        for (const file of await collectGgufFiles(candidate)) files.add(file);
      } else if (
        info.isFile() &&
        (candidate.toLowerCase().endsWith('.gguf') ||
          candidate.toLowerCase().endsWith('.gguf.partial'))
      ) {
        files.add(candidate);
      }
    } catch {
      // Ignore invalid candidates
    }
  }

  const models: GgufModel[] = [];
  const batchSize = 4;
  const fileList = [...files];
  for (let index = 0; index < fileList.length; index += batchSize) {
    const batch = fileList.slice(index, index + batchSize);
    const inspected = await Promise.all(
      batch.map(async (file) => {
        if (file.toLowerCase().endsWith('.gguf.partial')) {
          return describeUnavailableGguf(
            file,
            'incomplete',
            'This download is incomplete. Resume or restart it from Discover before loading.',
          );
        }
        try {
          return await inspectGguf(file);
        } catch (error) {
          return describeUnavailableGguf(
            file,
            'invalid',
            `GGUF validation failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
    models.push(...inspected.filter((item): item is GgufModel => Boolean(item)));
  }

  const projectors = models.filter(isVisionProjector);
  for (const model of models) {
    if (isVisionProjector(model)) continue;
    const siblings = projectors.filter(
      (projector) => path.dirname(projector.path) === path.dirname(model.path),
    );
    // A single colocated projector is unambiguous. When a folder contains
    // several projectors, require an explicit pairing in the model manager.
    if (siblings.length === 1) Object.assign(model, pairVisionProjector(model, siblings[0]));
  }

  return aggregateSplitGgufModels(
    models
      .filter((model) => !isVisionProjector(model))
      .sort((a, b) => b.importedAt - a.importedAt)
  );
}

export function isVisionProjector(model: GgufModel): boolean {
  return (
    model.fileName.toLowerCase().includes('mmproj') ||
    String(model.metadata['general.type'] ?? '').toLowerCase() === 'mmproj'
  );
}

export function pairVisionProjector(model: GgufModel, projector: GgufModel): GgufModel {
  if (isVisionProjector(model)) throw new Error('Select the text/language GGUF as the main model');
  if (!isVisionProjector(projector)) {
    throw new Error('The selected vision file is not an mmproj GGUF projector');
  }
  if (projector.validationError) throw new Error(projector.validationError);
  return {
    ...model,
    mmprojPath: projector.path,
    mmprojName: projector.fileName,
    mmprojSize: projector.size,
    capabilities: { ...model.capabilities, vision: true },
  };
}

export async function inspectVisionModelPair(
  modelPath: string,
  projectorPath: string,
): Promise<GgufModel> {
  const [model, projector] = await Promise.all([
    inspectGguf(modelPath),
    inspectGguf(projectorPath),
  ]);
  return pairVisionProjector(model, projector);
}

function aggregateSplitGgufModels(models: GgufModel[]): GgufModel[] {
  const nonSplitModels: GgufModel[] = [];
  const splitGroups = new Map<string, GgufModel[]>();

  for (const model of models) {
    const fileName = model.fileName;
    const splitMatch = fileName.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);

    if (splitMatch) {
      const dir = path.dirname(model.path);
      const baseName = splitMatch[1];
      const groupKey = path.join(dir, baseName.toLowerCase());

      if (!splitGroups.has(groupKey)) {
        splitGroups.set(groupKey, []);
      }
      splitGroups.get(groupKey)!.push(model);
    } else {
      nonSplitModels.push(model);
    }
  }

  const aggregatedSplitModels: GgufModel[] = [];

  for (const [, parts] of splitGroups.entries()) {
    parts.sort((a, b) => a.path.localeCompare(b.path));

    const primary = parts[0];
    const fileName = primary.fileName;
    const splitMatch = fileName.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);
    const baseName = splitMatch ? splitMatch[1] : primary.name;

    const totalSize = parts.reduce((acc, p) => acc + p.size, 0);

    const aggregatedModel: GgufModel = {
      ...primary,
      name: baseName,
      size: totalSize,
    };

    aggregatedSplitModels.push(aggregatedModel);
  }

  return [...nonSplitModels, ...aggregatedSplitModels];
}

export class ModelScanner {
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  public async scanFolders(folders: string[]): Promise<GgufModel[]> {
    return scanModelPaths(folders);
  }

  public watchFolders(folders: string[], onChange: () => void): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    const validFolders = folders.filter((f) => fs.existsSync(f));
    if (validFolders.length === 0) return;

    this.watcher = chokidar.watch(validFolders, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      depth: 6,
      ignoreInitial: true,
    });

    const triggerDebouncedChange = () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        onChange();
      }, 1500);
    };

    this.watcher.on('add', triggerDebouncedChange);
    this.watcher.on('unlink', triggerDebouncedChange);
    this.watcher.on('change', triggerDebouncedChange);
  }

  public stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
