import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runGit(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], {
    maxBuffer: 20 * 1024 * 1024
  });
  return stdout.trim();
}

export async function isGitRepository(repoRoot: string): Promise<boolean> {
  try {
    const output = await runGit(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
    return output === "true";
  } catch {
    return false;
  }
}

export async function getWorkingTreeDiff(repoRoot: string): Promise<string> {
  if (!(await isGitRepository(repoRoot))) {
    return "";
  }

  const [staged, unstaged] = await Promise.all([
    runGit(repoRoot, ["diff", "--cached", "--", "."]).catch(() => ""),
    runGit(repoRoot, ["diff", "--", "."]).catch(() => "")
  ]);

  if (staged && unstaged) {
    return `${staged}\n\n${unstaged}`.trim();
  }
  return (staged || unstaged || "").trim();
}
