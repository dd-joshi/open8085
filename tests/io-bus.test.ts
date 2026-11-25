import assert from "node:assert/strict";
import test from "node:test";

import { formatTransfer, IoBus, type BusStep, type IoDevice } from "../lib/io/bus.ts";

class FakeChip implements IoDevice {
  readonly id: string;
  base: number;
  values = new Map<number, number>();
  writes: Array<[number, number]> = [];
  reads: number[] = [];
  ticks = 0;
  resets = 0;
  throwOnWrite = false;
  constructor(id: string, base: number) {
    this.id = id;
    this.base = base;
  }
  ports() {
    return [this.base, this.base + 1];
  }
  portName(port: number) {
    return port === this.base ? "R0" : "R1";
  }
  read(port: number) {
    return this.values.get(port) ?? 0;
  }
  write(port: number, value: number) {
    if (this.throwOnWrite) throw new Error("chip exploded");
    this.writes.push([port, value]);
    this.values.set(port, value);
  }
  afterRead(port: number) {
    this.reads.push(port);
  }
  tick(tStates: number) {
    this.ticks += tStates;
  }
  reset() {
    this.resets += 1;
    this.values.clear();
  }
}

const portsOf = () => {
  const ports = new Uint8Array(256);
  return { ports, setPort: (port: number, value: number) => (ports[port] = value) };
};

const step = (partial: Partial<BusStep>): BusStep => ({ pc: 0x2000, opcode: 0, bytes: [0], cycles: 4, portWrites: [], ...partial });

test("beforeStep loads chip values into the CPU ports it owns, and only those", () => {
  const bus = new IoBus();
  const chip = new FakeChip("A", 0x80);
  chip.values.set(0x80, 0x5a);
  bus.attach(chip);
  const cpu = portsOf();
  cpu.ports[0x10] = 0x77;
  bus.beforeStep(cpu);
  assert.equal(cpu.ports[0x80], 0x5a);
  assert.equal(cpu.ports[0x81], 0x00);
  assert.equal(cpu.ports[0x10], 0x77);
});

test("afterStep delivers OUT writes to the owner, ignores other ports and logs the transfer", () => {
  const bus = new IoBus();
  const chip = new FakeChip("8255", 0x80);
  bus.attach(chip);
  bus.afterStep(step({ pc: 0x2005, opcode: 0xd3, bytes: [0xd3, 0x81], cycles: 10, portWrites: [{ port: 0x81, previous: 0, value: 0x89 }, { port: 0x01, previous: 0, value: 1 }] }));
  assert.deepEqual(chip.writes, [[0x81, 0x89]]);
  assert.equal(chip.ticks, 10);
  assert.equal(bus.log.length, 1);
  assert.equal(formatTransfer(bus.log[0]), "2005: OUT 81H ← 89H (8255 R1)");
  assert.deepEqual(bus.lastFor("8255"), bus.log[0]);
  assert.equal(bus.lastFor("8155"), null);
});

test("afterStep reports IN side effects only for owned ports", () => {
  const bus = new IoBus();
  const chip = new FakeChip("8155", 0x20);
  chip.values.set(0x20, 0x40);
  bus.attach(chip);
  bus.afterStep(step({ opcode: 0xdb, bytes: [0xdb, 0x20] }));
  bus.afterStep(step({ opcode: 0xdb, bytes: [0xdb, 0x02] }));
  assert.deepEqual(chip.reads, [0x20]);
  assert.equal(formatTransfer(bus.log[0]), "2000: IN 20H → 40H (8155 R0)");
});

test("attach rejects reserved ports and clashes between chips", () => {
  const bus = new IoBus(new Map([[0x01, "the Virtual I/O board"]]));
  assert.throws(() => bus.attach(new FakeChip("A", 0x00)), /01H is already used by the Virtual I\/O board/);
  bus.attach(new FakeChip("A", 0x80));
  assert.throws(() => bus.attach(new FakeChip("B", 0x81)), /B port 81H is already used by A/);
});

test("conflict() lets a chip check a new base before moving", () => {
  const bus = new IoBus();
  const a = new FakeChip("A", 0x80);
  const b = new FakeChip("B", 0x20);
  bus.attach(a);
  bus.attach(b);
  b.base = 0x81;
  assert.match(bus.conflict(b) ?? "", /already used by A/);
  b.base = 0x40;
  assert.equal(bus.conflict(b), null);
  bus.rebuildOwners();
  assert.equal(bus.owner(0x40), b);
  assert.equal(bus.owner(0x20), undefined);
});

test("a chip fault is contained: the bus records it and stops calling chips", () => {
  const bus = new IoBus();
  const chip = new FakeChip("8255", 0x80);
  bus.attach(chip);
  bus.afterStep(step({ portWrites: [{ port: 0x80, previous: 0, value: 1 }] }));
  chip.throwOnWrite = true;
  bus.afterStep(step({ pc: 0x2010, portWrites: [{ port: 0x80, previous: 0, value: 2 }] }));
  assert.equal(bus.fault?.device, "8255");
  assert.equal(bus.fault?.message, "chip exploded");
  assert.equal(bus.fault?.log.length, 1);
  const ticksAtFault = chip.ticks;
  const cpu = portsOf();
  chip.values.set(0x80, 0x99);
  bus.beforeStep(cpu);
  bus.afterStep(step({ cycles: 7 }));
  assert.equal(cpu.ports[0x80], 0, "faulted bus must not touch CPU ports");
  assert.equal(chip.ticks, ticksAtFault, "faulted bus must not tick chips");
  bus.reset();
  assert.equal(bus.fault, null);
  assert.equal(chip.resets, 1);
});

test("the log keeps only the last 32 transfers", () => {
  const bus = new IoBus();
  bus.attach(new FakeChip("A", 0x80));
  for (let value = 0; value < 40; value += 1) bus.afterStep(step({ portWrites: [{ port: 0x80, previous: 0, value }] }));
  assert.equal(bus.log.length, 32);
  assert.equal(bus.log[0].value, 8);
});
