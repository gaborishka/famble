import { MapNode, RoomContentPayload, RunDataV2 } from '../../shared/types/game';
import { preloadRoomAudio } from './audioService';
import {
  applyRoomContentToRunData,
  generateRoomContent,
  preloadRoomImages,
} from './geminiService';

interface QueueTask {
  roomId: string;
  node: MapNode;
  resolve: (value: RoomContentPayload | null) => void;
}

interface RoomGenerationOrchestratorOptions {
  getRunData: () => RunDataV2;
  setRunData: (updater: (prev: RunDataV2) => RunDataV2) => void;
  maxConcurrent?: number;
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
    if (room?.status === 'ready' && room.payload) {
      return room.payload;
    }

    if (this.pending.has(node.id)) {
      return this.pending.get(node.id)!;
    }

    return this.enqueue(node, true);
  }

  prefetchFrom(currentNodeId: string | null, nodes: MapNode[], depth = 2) {
    if (this.disposed || depth <= 0) return;

    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const roots = currentNodeId
      ? [currentNodeId]
      : nodes.filter(node => node.row === 0).map(node => node.id);

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
        if (!inFlight && roomState?.status !== 'ready' && roomState?.status !== 'generating') {
          void this.enqueue(node, false);
        }
      }

      if (item.level >= depth) continue;
      node.nextNodes.forEach(nextId => queue.push({ id: nextId, level: item.level + 1 }));
    }
  }

  private enqueue(node: MapNode, highPriority: boolean): Promise<RoomContentPayload | null> {
    if (this.pending.has(node.id)) {
      return this.pending.get(node.id)!;
    }

    const promise = new Promise<RoomContentPayload | null>((resolve) => {
      const task: QueueTask = {
        roomId: node.id,
        node,
        resolve,
      };

      if (highPriority) {
        this.queue.unshift(task);
      } else {
        this.queue.push(task);
      }
      this.queuedRoomIds.add(node.id);

      this.updateRoomState(node.id, { status: 'queued', error: undefined });
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
    const { roomId, node, resolve } = task;

    this.updateRoomState(roomId, { status: 'generating', error: undefined });

    try {
      const workingRunData = this.getRunData();
      const payload = await generateRoomContent(workingRunData, node);

      await Promise.all([
        preloadRoomImages(workingRunData, roomId, payload),
        preloadRoomAudio(workingRunData, roomId, payload),
      ]);

      const manifestSnapshot = { ...workingRunData.objectManifest };
      this.setRunData(prev => applyRoomContentToRunData(prev, roomId, payload, manifestSnapshot));
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

  private updateRoomState(roomId: string, patch: { status: 'queued' | 'generating' | 'failed'; error?: string }) {
    this.setRunData(prev => {
      const prevState = prev.rooms[roomId] || { status: 'queued', lastUpdatedAt: Date.now() };
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
