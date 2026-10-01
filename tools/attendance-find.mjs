#!/usr/bin/env node

// Tim may cham cong trong mang LAN khi khong biet no dang o IP nao.
//
// Vi sao can: may dang lay IP qua DHCP, nen dia chi doi la bridge mat dau may
// ma HRM khong bao loi gi - trang May cham cong van hien trang thai cu, den ky
// luong moi phat hien thieu ngay cong. Script nay quet ca dai, loc theo MAC cua
// ZKTeco roi bat tay that de xac nhan, va bao neu IP da troi khoi .env.

import { execFile } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import { promisify } from 'node:util';
import { ZkAuthError, ZkDevice } from 'zkteco-protocol';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.RJ_DEVICE_PORT || 4370);
const COMM_KEY = Number(process.env.RJ_COMM_KEY || 0);
const CONFIGURED_IP = process.env.RJ_DEVICE_IP || '';

// OUI da dang ky cua ZKSoftware/ZKTeco - Ronald Jack la hang dan nhan lai.
const ZK_OUI = ['0017 61', '00:17:61', '00-17-61'];

const ok = (text) => console.log(`  \x1b[32m/\x1b[0m ${text}`);
const warn = (text) => console.log(`  \x1b[33m!\x1b[0m ${text}`);
const info = (text) => console.log(`    ${text}`);

function localSubnets() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      // Chi quet /24; dai rong hon thi quet toan bo la khong thuc te.
      if (entry.netmask !== '255.255.255.0') continue;
      out.push({ address: entry.address, prefix: entry.address.split('.').slice(0, 3).join('.') });
    }
  }
  return out;
}

function probe(host, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: PORT });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function arpTable() {
  // Bang ARP chi co dong cho host vua duoc noi toi - goi sau khi quet xong.
  try {
    const { stdout } = await execFileAsync('arp', ['-a']);
    return stdout;
  } catch {
    return '';
  }
}

function macOf(arp, ip) {
  // Doi dau "." trong IP thanh "\." de khong khop nham 192.168.1.7 voi .17
  const line = arp.split(/\r?\n/).find((row) => new RegExp(`\\b${ip.replace(/\./g, '\\.')}\\b`).test(row));
  const match = line?.match(/([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i);
  return match ? match[0] : null;
}

const subnets = localSubnets();
if (subnets.length === 0) {
  console.error('Khong thay card mang IPv4 /24 nao dang hoat dong.');
  process.exit(1);
}

console.log(`\n\x1b[1mQuet cong ${PORT} tren ${subnets.length} dai mang\x1b[0m`);
for (const subnet of subnets) info(`${subnet.prefix}.0/24  (may nay: ${subnet.address})`);

const hits = [];
for (const subnet of subnets) {
  // Quet song song ca dai: 254 socket cung luc, moi cai cho toi 2.5s.
  const results = await Promise.all(
    Array.from({ length: 254 }, (_, index) => {
      const host = `${subnet.prefix}.${index + 1}`;
      return probe(host, 2500).then((open) => (open ? host : null));
    }),
  );
  hits.push(...results.filter(Boolean));
}

console.log('');
if (hits.length === 0) {
  warn(`Khong host nao mo cong ${PORT}.`);
  info('May cham cong dang tat, rut dien, rut day mang, hoac o dai mang khac.');
  info('Kiem tra den tin hieu o cong mang sau may va bieu tuong mang tren man hinh may.');
  process.exit(1);
}

const arp = await arpTable();
const found = [];

for (const host of hits) {
  const mac = macOf(arp, host);
  const isZk = mac ? ZK_OUI.some((oui) => mac.toLowerCase().startsWith(oui.toLowerCase().slice(0, 8))) : false;

  // Bat tay that moi chac: mot host mo 4370 chua han la may cham cong.
  const device = new ZkDevice({ host, port: PORT, commKey: COMM_KEY, timeoutMs: 8000 });
  let label = 'mo cong nhung khong bat tay duoc (co the khong phai may cham cong)';
  let confirmed = false;
  try {
    await device.connect();
    const identity = await device.getIdentity();
    const counts = await device.getInfo();
    label = `serial ${identity.serialNumber ?? '?'} | ${counts.userCount} nguoi | ${counts.recordCount} ban ghi`;
    confirmed = true;
  } catch (error) {
    if (error instanceof ZkAuthError) {
      label = 'la may ZKTeco nhung comm key dang dung bi tu choi';
      confirmed = true;
    }
  } finally {
    await device.disconnect().catch(() => undefined);
  }

  found.push({ host, mac, isZk, confirmed, label });
  const mark = confirmed ? ok : warn;
  mark(`${host}${mac ? `  (MAC ${mac}${isZk ? ', ZKTeco' : ''})` : ''}`);
  info(label);
}

const device = found.find((item) => item.confirmed) || found[0];
console.log('');
if (!device.confirmed) {
  warn('Khong xac nhan duoc may cham cong nao.');
  process.exit(1);
}
if (CONFIGURED_IP && CONFIGURED_IP !== device.host) {
  warn(`.env.attendance-bridge dang tro toi ${CONFIGURED_IP}, nhung may thuc o ${device.host}.`);
  info(`Sua RJ_DEVICE_IP thanh ${device.host}, roi dat IP tinh tren may de khoi troi lan nua.`);
} else if (CONFIGURED_IP) {
  ok(`Khop .env.attendance-bridge (RJ_DEVICE_IP = ${CONFIGURED_IP}).`);
} else {
  info(`Dat RJ_DEVICE_IP = ${device.host} trong .env.attendance-bridge.`);
}
