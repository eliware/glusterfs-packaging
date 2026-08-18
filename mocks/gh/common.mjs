import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const stateRoot =
  process.env.MOCK_GH_STATE || "/tmp/gluster-packaging-mock-gh";
const stateFile = path.join(stateRoot, "state.json");

const load = async () => {
  try {
    return JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    return { nextId: 1, runs: [] };
  }
};
const save = async (state) => {
  await mkdir(stateRoot, { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
};
const update = async (mutate) => {
  const lock = path.join(stateRoot, "lock");
  await mkdir(stateRoot, { recursive: true });
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  try {
    const state = await load();
    await mutate(state);
    await save(state);
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
};
const fieldsFromArgs = (args) => {
  const fields = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "-f") continue;
    const [name, ...value] = String(args[++index] || "").split("=");
    fields[name] = value.join("=");
  }
  return fields;
};
const runForId = async (id) =>
  (await load()).runs.find((item) => String(item.id) === String(id));

export async function mockGh(scenario) {
  const args = process.argv.slice(2);
  if (args[0] === "workflow" && args[1] === "run") {
    let dispatched;
    await update((state) => {
      dispatched = {
        id: state.nextId++,
        workflow: args[2],
        fields: fieldsFromArgs(args),
        createdAt: new Date().toISOString(),
      };
      dispatched.outcome = scenario.outcome(dispatched);
      state.runs.push(dispatched);
    });
    console.log(`mock dispatched ${dispatched.workflow} as ${dispatched.id}`);
    return;
  }
  if (args[0] === "run" && args[1] === "list") {
    const state = await load();
    const delay = Number(process.env.MOCK_GH_DELAY_MS || 2000);
    console.log(
      JSON.stringify(
        state.runs.map(({ id, workflow, fields, createdAt, outcome }) => {
          const completed = Date.now() - Date.parse(createdAt) >= delay;
          return {
            databaseId: id,
            status: completed ? "completed" : "in_progress",
            conclusion: completed
              ? outcome === "passed"
                ? "success"
                : outcome
              : null,
            createdAt,
            displayTitle: `${workflow} ${fields.dispatch_id || ""}`.trim(),
          };
        }),
      ),
    );
    return;
  }
  if (args[0] === "run" && args[1] === "view") {
    const run = await runForId(args[2]);
    if (!run) throw new Error(`unknown mock run ${args[2]}`);
    console.log(JSON.stringify({ inputs: run.fields }));
    return;
  }
  if (args[0] === "run" && args[1] === "watch") {
    const run = await runForId(args[2]);
    if (!run) throw new Error(`unknown mock run ${args[2]}`);
    await new Promise((resolve) =>
      setTimeout(resolve, Number(process.env.MOCK_GH_DELAY_MS || 2000)),
    );
    if (run.outcome === "failed") {
      console.error(`mock failure: ${run.workflow}`);
      process.exitCode = 1;
    } else console.log(`${run.workflow} completed successfully`);
    return;
  }
  if (args[0] === "run" && args[1] === "download") {
    const run = await runForId(args[2]);
    if (!run) throw new Error(`unknown mock run ${args[2]}`);
    const directory = args[args.indexOf("--dir") + 1];
    const artifact = args[args.indexOf("--name") + 1];
    await mkdir(directory, { recursive: true });
    await writeArtifact(run, artifact, directory);
    return;
  }
  throw new Error(`unsupported mock gh command: ${args.join(" ")}`);
}

async function writeArtifact(run, artifact, directory) {
  const { fields } = run;
  const output = path.join(directory, "result.json");
  if (artifact === "package-build-result") {
    await mkdir(fields.candidate_dir, { recursive: true });
    const rpm = run.workflow.startsWith("rpm");
    const packageDir = rpm
      ? path.join(fields.candidate_dir, "rpm")
      : path.join(
          fields.candidate_dir,
          "deb",
          fields.target_os,
          fields.deb_suite,
          "amd64",
          fields.gluster_version,
        );
    await mkdir(path.join(packageDir, rpm ? "repodata" : "dists/stable"), {
      recursive: true,
    });
    await writeFile(
      path.join(
        packageDir,
        rpm ? "repodata/repomd.xml" : "dists/stable/Release",
      ),
      "mock package metadata\n",
    );
    await writeFile(
      path.join(fields.candidate_dir, "result.json"),
      JSON.stringify({
        package_format: rpm ? "rpm" : "deb",
        channel: fields.channel,
        source_ref: fields.source_ref,
        source_commit: fields.source_commit,
        version: fields.gluster_version,
        package_version: fields.package_version,
        candidate_dir: fields.candidate_dir,
        smoke_stage: "smoke-1",
        validation: packageValidation(
          rpm ? "centos-stream-10" : `${fields.target_os}-${fields.deb_suite}`,
        ),
      }) + "\n",
    );
    await writeFile(
      output,
      JSON.stringify({
        candidate_dir: fields.candidate_dir,
        package_format: rpm ? "rpm" : "deb",
        source_commit: fields.source_commit,
        validation: packageValidation(
          rpm ? "centos-stream-10" : `${fields.target_os}-${fields.deb_suite}`,
        ),
      }) + "\n",
    );
    return;
  }
  throw new Error(`unsupported mock artifact: ${artifact}`);
}

function packageValidation(id) {
  return {
    package_format: "mock",
    checks: Object.fromEntries(
      [
        "install",
        "service_start",
        "volume_create_mount",
        "file_lifecycle",
        "volume_unmount_delete",
        "service_shutdown",
      ].map((name) => [name, { status: "passed" }]),
    ),
    distributions: [{ id, package_core: { status: "passed" } }],
  };
}
