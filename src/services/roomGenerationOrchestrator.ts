import { GeneratedObjectManifestEntry, MapNode, RoomContentPayload, RunDataV2 } from '../../shared/types/game';
import { preloadRoomAudio } from './audioService';
import {
  applyRoomContentToRunData,
  generateRoomContent,
  preloadRoomImages,
} from './geminiService';

interface QueueTask {
  roomId: string;
  node: MapNode;
  mode: 'media' | 'full';
  highPriority: boolean;
  resolve: (value: RoomContentPayload | null) => void;
}

interface RoomGenerationOrchestratorOptions {
  getRunData: () => RunDataV2;
  setRunData: (updater: (prev: RunDataV2) => RunDataV2) => void;
  maxConcurrent?: number;
}

function getNodeRow(node: MapNode): number {
  return node.row ?? Math.round(node.y / 20);
}

function collectPayloadObjectIds(payload: RoomContentPayload): string[] {
  const ids = new Set<string>();
  const add = (id?: string) => {
    if (id) ids.add(id);
  };
  const addMany = (list?: string[]) => {
    list?.forEach(id => add(id));
  };

  const refs = payload.objectRefs;
  add(refs?.backgroundImageId);
  add(refs?.playerPortraitImageId);
  add(refs?.playerSpriteImageId);
  add(refs?.enemySpriteImageId);
  addMany(refs?.enemySpriteImageIds);
  add(refs?.bossSpriteImageId);
  add(refs?.eventImageId);
  addMany(refs?.cardImageIds);
  add(refs?.roomMusicId);
  add(refs?.bossMusicId);
  add(refs?.enemySfxId);
  addMany(refs?.enemySfxIds);
  add(refs?.bossSfxId);
  add(refs?.bossTtsId);
  addMany(refs?.cardSfxIds);

  if (payload.nodeType === 'Combat' || payload.nodeType === 'Elite') {
    payload.enemies.forEach(enemy => {
      add(enemy.imageObjectId);
      add(enemy.audioObjectId);
    });
    payload.rewardCards?.forEach(card => {
      add(card.imageObjectId);
      add(card.audioObjectId);
    });
  }

  if (payload.nodeType === 'Boss') {
    add(payload.boss.imageObjectId);
    add(payload.boss.audioObjectId);
    add(payload.boss.narratorAudioObjectId);
  }

  if (payload.nodeType === 'Event') {
    payload.choices.forEach(choice => {
      add(choice.effects.addCard?.imageObjectId);
      add(choice.effects.addCard?.audioObjectId);
    });
  }

  if (payload.nodeType === 'Shop') {
    payload.shopCards.forEach(card => {
      add(card.imageObjectId);
      add(card.audioObjectId);
    });
  }

  return Array.from(ids);
}

function roomNeedsMedia(
  payload: RoomContentPayload,
  manifest: Record<string, GeneratedObjectManifestEntry>,
): boolean {
  const ids = collectPayloadObjectIds(payload);
  if (ids.length === 0) return false;
  return ids.some(id => manifest[id]?.status !== 'ready');
}

export class RoomGenerationOrchestrator {
  private readonly getRunData: () => RunDataV2;
  private readonly setRunData: (updater: (prev: RunDataV2) => RunDataV2) => void;
  private readonly maxConcurrent: number;
  private readonly queue: QueueTask[] = [];
  private readonly pending = new Map<string, Promise<RoomContentPayload | null>>();
  private readonly queuedRoomIds = new Set<string>();
  private runningCount = 0;
  private disposed = false;

  constructor(options: RoomGenerationOrchestratorOptions) {
    this.getRunData = options.getRunData;
    this.setRunData = options.setRunData;
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 2);
  }

  dispose() {
    this.disposed = true;
    this.queue.length = 0;
    this.pending.clear();
    this.queuedRoomIds.clear();
  }

  async ensureRoomReady(node: MapNode): Promise<RoomContentPayload | null> {
    const runData = this.getRunData();
    const room = runData.rooms[node.id];

    if (room?.payload) {
      if (!roomNeedsMedia(room.payload, runData.objectManifest)) {
        return room.payload;
      }
      if (this.pending.has(node.id)) {
        return this.pending.get(node.id)!;
      }
      return this.enqueue(node, true, 'media');
    }

    if (this.pending.has(node.id)) {
      return this.pending.get(node.id)!;
    }

    return this.enqueue(node, true, 'full');
  }

  prefetchFrom(currentNodeId: string | null, nodes: MapNode[], depth = 2) {
    if (this.disposed || depth <= 0) return;

    const nodeById = new Map(nodes.map(node => [node.id, node]));
    let roots: string[] = [];
    if (currentNodeId) {
      roots = [currentNodeId];
    } else {
      const rowZeroRoots = nodes.filter(node => getNodeRow(node) === 0).map(node => node.id);
      if (rowZeroRoots.length > 0) {
        roots = rowZeroRoots;
      } else if (nodes.length > 0) {
        const minRow = nodes.reduce((min, node) => Math.min(min, getNodeRow(node)), Number.POSITIVE_INFINITY);
        roots = nodes.filter(node => getNodeRow(node) === minRow).map(node => node.id);
      }
    }
    if (roots.length === 0) return;

    const visited = new Set<string>();
    const queue: Array<{ id: string; level: number }> = roots.map(id => ({ id, level: 0 }));

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (visited.has(item.id)) continue;
      visited.add(item.id);

      const node = nodeById.get(item.id);
      if (!node) continue;

      if (item.level > 0 && item.level <= depth) {
        const runData = this.getRunData();
        const roomState = runData.rooms[node.id];
        const inFlight = this.pending.has(node.id) || this.queuedRoomIds.has(node.id);

        if (!inFlight && roomState?.payload) {
          if (roomNeedsMedia(roomState.payload, runData.objectManifest)) {
            void this.enqueue(node, false, 'media');
          }
        } else if (!inFlight && (!roomState || !roomState.payload)) {
          // Legacy compatibility: old snapshots may not contain payload yet.
          void this.enqueue(node, false, 'full');
        }
      }

      if (item.level >= depth) continue;
      node.nextNodes.forEach(nextId => queue.push({ id: nextId, level: item.level + 1 }));
    }
  }

  private enqueue(node: MapNode, highPriority: boolean, mode: 'media' | 'full'): Promise<RoomContentPayload | null> {
    if (this.pending.has(node.id)) {
      return this.pending.get(node.id)!;
    }

    const currentRoom = this.getRunData().rooms[node.id];
    if (mode === 'media' && currentRoom?.payload && !roomNeedsMedia(currentRoom.payload, this.getRunData().objectManifest)) {
      return Promise.resolve(currentRoom.payload);
    }
    if (mode === 'full' && currentRoom?.status === 'ready' && currentRoom.payload) {
      return Promise.resolve(currentRoom.payload);
    }

    const promise = new Promise<RoomContentPayload | null>((resolve) => {
      const task: QueueTask = {
        roomId: node.id,
        node,
        mode,
        highPriority,
        resolve,
      };

      if (highPriority) {
        this.queue.unshift(task);
      } else {
        this.queue.push(task);
      }
      this.queuedRoomIds.add(node.id);

      if (mode === 'full') {
        this.updateRoomState(node.id, { status: 'queued', error: undefined });
      }
      this.pump();
    });

    this.pending.set(node.id, promise);
    return promise;
  }

  private pump() {
    if (this.disposed) return;

    while (this.runningCount < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.queuedRoomIds.delete(task.roomId);
      this.runningCount += 1;

      this.runTask(task)
        .catch(err => {
          console.error('Room generation task failed:', err);
        })
        .finally(() => {
          this.runningCount -= 1;
          this.pump();
        });
    }
  }

  private async runTask(task: QueueTask): Promise<void> {
    const { roomId, node, mode, resolve } = task;
    const latestRoom = this.getRunData().rooms[roomId];

    if (mode === 'media' && latestRoom?.payload) {
      if (!roomNeedsMedia(latestRoom.payload, this.getRunData().objectManifest)) {
        resolve(latestRoom.payload);
        this.pending.delete(roomId);
        return;
      }

      try {
        const workingRunData = this.getRunData();
        const payload = workingRunData.rooms[roomId]?.payload || latestRoom.payload;
        if (!payload) {
          resolve(null);
          return;
        }

        await Promise.all([
          preloadRoomImages(workingRunData, roomId, payload),
          preloadRoomAudio(workingRunData, roomId, payload),
        ]);

        const manifestPatch = this.buildRoomManifestPatch(workingRunData, roomId, payload);
        this.setRunData(prev => ({
          ...prev,
          objectManifest: {
            ...prev.objectManifest,
            ...manifestPatch,
          },
          rooms: {
            ...prev.rooms,
            [roomId]: {
              ...(prev.rooms[roomId] || { status: 'ready', lastUpdatedAt: Date.now() }),
              status: 'ready',
              error: undefined,
              lastUpdatedAt: Date.now(),
              payload,
            },
          },
        }));
        resolve(payload);
      } catch (err) {
        console.error(`Room media preload failed for ${roomId}:`, err);
        resolve(latestRoom.payload);
      } finally {
        this.pending.delete(roomId);
      }
      return;
    }

    if (latestRoom?.status === 'ready' && latestRoom.payload) {
      resolve(latestRoom.payload);
      this.pending.delete(roomId);
      return;
    }

    this.updateRoomState(roomId, { status: 'generating', error: undefined });

    try {
      const workingRunData = this.getRunData();
      const payload = await generateRoomContent(workingRunData, node);

      await Promise.all([
        preloadRoomImages(workingRunData, roomId, payload),
        preloadRoomAudio(workingRunData, roomId, payload),
      ]);

      const manifestPatch = this.buildRoomManifestPatch(workingRunData, roomId, payload);
      this.setRunData(prev => applyRoomContentToRunData(prev, roomId, payload, manifestPatch));
      resolve(payload);
    } catch (err) {
      this.updateRoomState(roomId, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      resolve(null);
    } finally {
      this.pending.delete(roomId);
    }
  }

  private buildRoomManifestPatch(
    runData: RunDataV2,
    roomId: string,
    payload: RoomContentPayload,
  ): Record<string, GeneratedObjectManifestEntry> {
    const ids = new Set<string>();
    const add = (id?: string) => {
      if (id) ids.add(id);
    };
    const addMany = (list?: string[]) => {
      list?.forEach(id => add(id));
    };

    const refs = payload.objectRefs;
    add(refs?.backgroundImageId);
    add(refs?.playerPortraitImageId);
    add(refs?.playerSpriteImageId);
    add(refs?.enemySpriteImageId);
    addMany(refs?.enemySpriteImageIds);
    add(refs?.bossSpriteImageId);
    add(refs?.eventImageId);
    addMany(refs?.cardImageIds);
    add(refs?.roomMusicId);
    add(refs?.bossMusicId);
    add(refs?.enemySfxId);
    addMany(refs?.enemySfxIds);
    add(refs?.bossSfxId);
    add(refs?.bossTtsId);
    addMany(refs?.cardSfxIds);

    if (payload.nodeType === 'Combat' || payload.nodeType === 'Elite') {
      payload.enemies.forEach(enemy => {
        add(enemy.imageObjectId);
        add(enemy.audioObjectId);
      });
      payload.rewardCards?.forEach(card => {
        add(card.imageObjectId);
        add(card.audioObjectId);
      });
    }

    if (payload.nodeType === 'Boss') {
      add(payload.boss.imageObjectId);
      add(payload.boss.audioObjectId);
      add(payload.boss.narratorAudioObjectId);
    }

    if (payload.nodeType === 'Event') {
      payload.choices.forEach(choice => {
        add(choice.effects.addCard?.imageObjectId);
        add(choice.effects.addCard?.audioObjectId);
      });
    }

    if (payload.nodeType === 'Shop') {
      payload.shopCards.forEach(card => {
        add(card.imageObjectId);
        add(card.audioObjectId);
      });
    }

    Object.entries(runData.objectManifest).forEach(([id, entry]) => {
      if (entry.roomId === roomId) {
        ids.add(id);
      }
    });

    const patch: Record<string, GeneratedObjectManifestEntry> = {};
    ids.forEach(id => {
      const entry = runData.objectManifest[id];
      if (entry) patch[id] = entry;
    });

    return patch;
  }

  private updateRoomState(roomId: string, patch: { status: 'queued' | 'generating' | 'failed'; error?: string }) {
    this.setRunData(prev => {
      const prevState = prev.rooms[roomId] || { status: 'queued', lastUpdatedAt: Date.now() };
      if (prevState.status === 'ready' && prevState.payload) {
        return prev;
      }
      return {
        ...prev,
        rooms: {
          ...prev.rooms,
          [roomId]: {
            ...prevState,
            ...patch,
            lastUpdatedAt: Date.now(),
          },
        },
      };
    });
  }
}
