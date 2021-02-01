import { SkeldjsClient } from "@skeldjs/client";
import { TypedEmitter, Vector2 } from "@skeldjs/util";

import {
    CustomNetworkTransform,
    PlayerData,
    PlayerDataResolvable,
    TheSkeldVent,
    MiraHQVent,
    PolusVent,
    MapVentData,
    Room
} from "@skeldjs/core"

import fs from "fs";
import path from "path";

import { PathfinderConfig } from "./interface/PathfinderConfig";
import { Grid } from "./util/Grid";
import { Node } from "./util/Node";

import { getShortestPath } from "./engine";

type SkeldjsPathfinderEvents = {
    start: (destination: Vector2) => void;
    stop: (reached: boolean) => void;
    pause: () => void;
    recalculate: (path: Node[]) => void;
}

export class SkeldjsPathfinder extends TypedEmitter<SkeldjsPathfinderEvents> {
    private _tick: number;
    private _moved: boolean;
    private _paused: boolean;
    destination: Vector2;
    grid: Grid;
    path: Node[];
    following: PlayerData;

    constructor(private client: SkeldjsClient, public config: PathfinderConfig = {}) {
        super();

        this.client.on("fixedUpdate", this._ontick.bind(this));
        this.client.on("move", this._handleMove.bind(this));
        this.client.on("leave", this._handleLeave.bind(this));
    }

    private get snode() {
        if (!this.position)
            return null;

        return this.grid.nearest(this.position.x, this.position.y);
    }

    private get dnode() {
        if (!this.destination)
            return null;

        return this.grid.nearest(this.destination.x, this.destination.y);
    }

    get position() {
        return this.transform?.position;
    }

    get transform(): CustomNetworkTransform {
        return this.me?.transform;
    }

    get me() {
        return this.room?.me;
    }

    get room() {
        return this.client?.room;
    }

    get map() {
        return this.room?.settings?.map;
    }

    get paused() {
        return this._paused;
    }

    private _ontick() {
        this._tick++;

        if (typeof this.map === "undefined")
            return;

        if (!this.grid) {
            const buff = fs.readFileSync(path.resolve(__dirname, "../../data/build", ""+this.map));
            this.grid = Grid.fromBuffer(buff);
        }

        if (!this.snode || !this.dnode)
            return;

        if (this._moved || !this.path || this._tick % (this.config.recalculateEvery || 1) === 0) {
            this.recalculate();
            this._moved = false;
            this.emit("recalculate", this.path);
        }

        if (this._paused)
            return;

        const next = this.path.shift();

        if (next) {
            const pos = this.grid.actual(next.x, next.y);
            this.transform.move(pos);

            if (this.path.length === 0) {
                this._stop(true);
            }
        } else {
            this.destination = null;
            this.path = null;
        }
    }

    recalculate() {
        this.grid.reset();
        this.path = getShortestPath(this.grid, this.snode, this.dnode);
    }

    pause() {
        this._paused = true;
        this.emit("pause");
    }

    start() {
        this._paused = false;
        this.emit("start");
    }

    private _stop(reached: boolean) {
        this.destination = null;
        if (!reached) this._moved = true;

        this.emit("stop", reached);
    }

    stop() {
        this._stop(false);
    }

    private _go(dest: Vector2) {
        this.destination =  { // Recreate object to not recalculate new player position after moving.
            x: dest.x,
            y: dest.y
        };
        this._moved = true;
        this.start();
    }

    go(pos: PlayerDataResolvable|Vector2|Node) {
        const vec = pos as Vector2;

        if (vec.x) {
            this._go(vec);
            return;
        }

        if (pos instanceof Node) {
            return this.grid.actual(pos.x, pos.y)
        }

        const resolved = this.client?.room?.resolvePlayer(pos as PlayerDataResolvable);

        if (resolved && resolved.spawned) {
            const position = resolved.transform.position;

            return this.go(position);
        }
    }

    vent(ventid: TheSkeldVent|MiraHQVent|PolusVent) {
        if (!this.map)
            return;

        const coords = MapVentData[this.map][ventid];

        this.go(coords.position);
    }

    private _handleMove(room: Room, transform: CustomNetworkTransform, position: Vector2) {
        if (transform.owner === this.following) {
            this.destination = {
                x: position.x,
                y: position.y
            };
            this._moved = true;
        }
    }

    private _handleLeave(room: Room, player: PlayerData) {
        if (player === this.following) {
            this._stop(false);
            this.following = null;
        }
    }

    follow(player: PlayerDataResolvable) {
        const resolved = this.client?.room?.resolvePlayer(player);

        if (resolved && resolved.spawned) {
            this.following = resolved;
        }
    }

    static FixedUpdateInterval = 25 as const;
}