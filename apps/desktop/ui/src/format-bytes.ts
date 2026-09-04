export function formatBytes(bytes: number): string {
  const unit = bytes >= 1024 ** 3 ? 'GiB' : bytes >= 1024 ** 2 ? 'MiB' : bytes >= 1024 ? 'KiB' : 'B';
  const divisor = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[unit];
  return `${Number((bytes / divisor).toFixed(1))} ${unit}`;
}
