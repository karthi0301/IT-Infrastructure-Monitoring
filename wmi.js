// Server health WITHOUT SNMP and without installing any agent on the servers. Uses classic WMI
// over DCOM (the same mechanism tools like "Computer Management -> Connect to another computer"
// use), run through PowerShell. Pulls disk usage, CPU load, RAM usage, and (optionally) the
// state of specific Windows services, all in one round trip.
//
// No domain here, so servers don't share one trusted login: by default this uses whatever
// account is running the monitor (works when that account happens to be the same local
// admin on the target server). For a server with a DIFFERENT local admin password, add
// "wmiUser" and "wmiPass" to that device in devices.json and this will use those instead
// — see the README for a security note on storing that.
import { execFile } from "child_process";

function runPS(script, timeoutMs) {
  return new Promise((resolve) => {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      resolve({ err, stdout: String(stdout || "").trim() });
    });
  });
}

// PowerShell single-quoted string: only ' itself needs escaping, by doubling it.
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// services: optional array of Windows service names to check (e.g. ["Spooler", "MSSQLSERVER"]).
export async function getServerHealth(ip, { user, pass, services = [], timeoutMs = 9000 } = {}) {
  if (process.platform !== "win32") return { ok: false, error: "Server health needs the monitor to run on Windows (it uses PowerShell/WMI).", checkedAt: Date.now() };

  const credBlock = user && pass
    ? `$sec = ConvertTo-SecureString ${psQuote(pass)} -AsPlainText -Force\n  $cred = New-Object System.Management.Automation.PSCredential(${psQuote(user)}, $sec)\n  $s = New-CimSession -ComputerName ${psQuote(ip)} -SessionOption $opt -Credential $cred -OperationTimeoutSec 8`
    : `$s = New-CimSession -ComputerName ${psQuote(ip)} -SessionOption $opt -OperationTimeoutSec 8`;

  const svcFilter = services.length ? services.map((n) => `Name='${String(n).replace(/'/g, "''")}'`).join(" or ") : null;
  const svcBlock = svcFilter
    ? `$svc = Get-CimInstance -CimSession $s -ClassName Win32_Service -Filter ${psQuote(svcFilter)} | Select-Object Name, State, StartMode`
    : `$svc = @()`;

  const script = `
$ErrorActionPreference = 'Stop'
try {
  $opt = New-CimSessionOption -Protocol Dcom
  ${credBlock}
  $d = Get-CimInstance -CimSession $s -ClassName Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, Size, FreeSpace
  $os = Get-CimInstance -CimSession $s -ClassName Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory
  $cpu = (Get-CimInstance -CimSession $s -ClassName Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
  ${svcBlock}
  Remove-CimSession $s
  [PSCustomObject]@{ disks = @($d); os = $os; cpuPercent = $cpu; services = @($svc) } | ConvertTo-Json -Compress -Depth 4
} catch {
  Write-Output ("ERR:" + $_.Exception.Message)
}`.trim();

  const { err, stdout } = await runPS(script, timeoutMs);
  if (!stdout || stdout.startsWith("ERR:")) {
    return { ok: false, error: (stdout.replace(/^ERR:/, "") || err?.message || "No response").trim().slice(0, 200), checkedAt: Date.now() };
  }
  try {
    const parsed = JSON.parse(stdout);
    const GiB = 1024 ** 3, MiB = 1024 ** 2;
    let disks = Array.isArray(parsed.disks) ? parsed.disks : parsed.disks ? [parsed.disks] : [];
    disks = disks.map((x) => {
      const total = Number(x.Size) || 0, free = Number(x.FreeSpace) || 0, used = Math.max(0, total - free);
      // Divide by 1024^3 (GiB), not 1e9 (decimal GB), so these numbers match what
      // Windows Explorer / "This PC" shows for the same drive (Explorer's "GB" is really GiB).
      return { drive: x.DeviceID, totalGB: +(total / GiB).toFixed(1), freeGB: +(free / GiB).toFixed(1), usedGB: +(used / GiB).toFixed(1), percent: total ? Math.round((used / total) * 100) : 0 };
    }).sort((a, b) => a.drive.localeCompare(b.drive));

    let ram = null;
    if (parsed.os) {
      const totalKB = Number(parsed.os.TotalVisibleMemorySize) || 0, freeKB = Number(parsed.os.FreePhysicalMemory) || 0;
      const totalGB = totalKB / MiB, usedGB = Math.max(0, (totalKB - freeKB) / MiB);
      ram = { totalGB: +totalGB.toFixed(1), usedGB: +usedGB.toFixed(1), percent: totalKB ? Math.round((usedGB / totalGB) * 100) : 0 };
    }

    let svcs = Array.isArray(parsed.services) ? parsed.services : parsed.services ? [parsed.services] : [];
    svcs = svcs.map((s) => ({ name: s.Name, running: String(s.State).toLowerCase() === "running", state: s.State }));

    return { ok: true, disks, ram, cpuPercent: parsed.cpuPercent == null ? null : Math.round(parsed.cpuPercent), services: svcs, checkedAt: Date.now() };
  } catch {
    return { ok: false, error: "Got a reply but couldn't read it", checkedAt: Date.now() };
  }
}

// Kept for anything that still imports the old name — same thing, disk-only callers just ignore the extra fields.
export const getDiskUsage = getServerHealth;
