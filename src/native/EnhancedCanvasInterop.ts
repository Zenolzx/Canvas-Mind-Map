import type { App, Menu } from 'obsidian';
import type { CanvasNode } from '../../Canvas';
import { around } from 'monkey-around';
import { meta } from './NativeCanvasModel';

interface LegacyMindmap {
    addMenu(menu: Menu, node: CanvasNode): unknown;
    generate(canvas: unknown, node: CanvasNode, ...args: unknown[]): unknown;
}
/** Reserve each engine's own namespace when the locally extended Enhanced Canvas is present. */
export class EnhancedCanvasInterop {
    private current?: LegacyMindmap;
    private remove?: () => void;
    constructor(private app: App) {}
    refresh(): void {
        const registry = this.app as App & { plugins?: { plugins?: Record<string, { mindmap?: LegacyMindmap }> } };
        const feature = registry.plugins?.plugins?.['enhanced-canvas']?.mindmap;
        if (feature === this.current) return;
        this.remove?.(); this.remove = undefined; this.current = feature;
        if (!feature || typeof feature.addMenu !== 'function' || typeof feature.generate !== 'function') return;
        this.remove = around(feature, {
            addMenu: next => function(this: LegacyMindmap, menu: Menu, node: CanvasNode) {
                if (meta(node.getData())) return;
                return next.call(this, menu, node);
            },
            generate: next => function(this: LegacyMindmap, canvas: unknown, node: CanvasNode, ...args: unknown[]) {
                if (meta(node.getData())) return;
                return next.call(this, canvas, node, ...args);
            },
        });
    }
    close(): void { this.remove?.(); this.remove = undefined; this.current = undefined; }
}
