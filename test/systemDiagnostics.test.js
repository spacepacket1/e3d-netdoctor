import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import {
  gatherSystemDiagnostics,
  runNetstat,
  runPing,
  runTraceroute,
} from '../src/systemDiagnostics.js';

function createSpawnStub(handlers = {}) {
  return function spawnStub(...args) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      child.killed = true;
    };

    queueMicrotask(async () => {
      try {
        await handlers.onSpawn?.(child, ...args);
      } catch (error) {
        child.emit('error', error);
      }
    });

    return child;
  };
}

function closeWith(child, { stdout = '', stderr = '', code = 0 } = {}) {
  if (stdout) child.stdout.emit('data', Buffer.from(stdout));
  if (stderr) child.stderr.emit('data', Buffer.from(stderr));
  child.emit('close', code);
}

test('runPing parses a successful BSD ping summary', async () => {
  const spawnImpl = createSpawnStub({
    onSpawn: (child) => closeWith(child, {
      stdout: [
        'PING 8.8.8.8 (8.8.8.8): 56 data bytes',
        '64 bytes from 8.8.8.8: icmp_seq=0 ttl=115 time=24.938 ms',
        '',
        '--- 8.8.8.8 ping statistics ---',
        '2 packets transmitted, 2 packets received, 0.0% packet loss',
        'round-trip min/avg/max/stddev = 24.938/26.131/27.325/1.194 ms',
      ].join('\n'),
    }),
  });

  const result = await runPing('8.8.8.8', { count: 2, spawnImpl });
  assert.equal(result.ok, true);
  assert.equal(result.transmitted, 2);
  assert.equal(result.received, 2);
  assert.equal(result.packetLossPercent, 0);
  assert.equal(result.rttAvgMs, 26.131);
  assert.equal(result.rttMaxMs, 27.325);
});

test('runPing surfaces an unreachable-host error without throwing', async () => {
  const spawnImpl = createSpawnStub({
    onSpawn: (child) => closeWith(child, {
      stderr: 'ping: cannot resolve bad.invalid: Unknown host',
      code: 68,
    }),
  });

  const result = await runPing('bad.invalid', { count: 1, spawnImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown host/);
});

test('runTraceroute parses hop lines and flags timed-out hops', async () => {
  const spawnImpl = createSpawnStub({
    onSpawn: (child) => closeWith(child, {
      stdout: [
        'traceroute to 8.8.8.8 (8.8.8.8), 8 hops max',
        ' 1  10.0.0.1 (10.0.0.1)  0.895 ms',
        ' 2  * * *',
        ' 3  po-125-rur102.pittsburg.ca.sfba.comcast.net (96.216.8.201)  16.121 ms',
      ].join('\n'),
    }),
  });

  const result = await runTraceroute('8.8.8.8', { maxHops: 3, spawnImpl });
  assert.equal(result.ok, true);
  assert.equal(result.hopCount, 3);
  assert.equal(result.timedOutHopCount, 1);
  assert.equal(result.hops[0].address, '10.0.0.1');
  assert.equal(result.hops[1].timedOut, true);
  assert.match(result.hops[2].host, /comcast\.net/);
  assert.equal(result.hops[2].rttsMs[0], 16.121);
});

test('runNetstat parses protocol stats and skips blank-address interface rows correctly', async () => {
  let call = 0;
  const spawnImpl = createSpawnStub({
    onSpawn: (child) => {
      call += 1;
      if (call === 1) {
        closeWith(child, {
          stdout: [
            'tcp:',
            '\t0 packet sent',
            '\t\t3 data packet (100 byte) retransmitted',
            '\t0 packet received',
            '\t\t2 duplicate acks',
            '\t0 connection established (including accepts)',
            '\t0 connection closed (including 1 drop)',
            '\t0 retransmit timeout',
          ].join('\n'),
        });
        return;
      }
      closeWith(child, {
        stdout: [
          'Name       Mtu   Network       Address            Ipkts Ierrs    Opkts Oerrs  Coll',
          'lo0        16384 <Link#1>                        810964     0   810964     0     0',
          'en0        1500  <Link#7>    d0:11:e5:02:d3:15 64561164   200 31201592     0     0',
        ].join('\n'),
      });
    },
  });

  const result = await runNetstat({ spawnImpl });
  assert.equal(result.ok, true);
  assert.equal(result.protocolStats.retransmittedDataPackets, 3);
  assert.equal(result.protocolStats.duplicateAcksReceived, 2);
  assert.equal(result.protocolStats.connectionsDropped, 1);

  const lo0 = result.interfaces.find((iface) => iface.name === 'lo0');
  const en0 = result.interfaces.find((iface) => iface.name === 'en0');
  assert.equal(lo0.inputPackets, 810964);
  assert.equal(lo0.inputErrors, 0);
  assert.equal(en0.inputErrors, 200);
  assert.equal(en0.inputPackets, 64561164);
});

test('gatherSystemDiagnostics targets the top affected destinations and reports when none are available', async () => {
  const findings = {
    tcpHealth: {
      affectedConversations: [
        { remoteAddress: '93.184.216.34' },
        { remoteAddress: '1.1.1.1' },
        { remoteAddress: '93.184.216.34' },
      ],
    },
    rttOutliers: { conversations: [{ remoteAddress: '8.8.8.8' }] },
  };

  const pinged = [];
  const result = await gatherSystemDiagnostics(findings, {
    systemDiagnosticsTargetLimit: 2,
    runPing: async (host) => {
      pinged.push(host);
      return { host, ok: true };
    },
    runTraceroute: async (host) => ({ host, ok: true, hops: [] }),
    runNetstat: async () => ({ ok: true }),
  });

  assert.deepEqual(pinged, ['93.184.216.34', '1.1.1.1']);
  assert.equal(result.targets.length, 2);
  assert.equal(result.skippedReason, null);

  const empty = await gatherSystemDiagnostics({}, {
    runPing: async () => ({ ok: true }),
    runTraceroute: async () => ({ ok: true }),
    runNetstat: async () => ({ ok: true }),
  });
  assert.equal(empty.targets.length, 0);
  assert.match(empty.skippedReason, /No affected destination/);
});
