# Bounded experiments

An experiment is an optional operation on a saved configuration. It does not enroll the computer into a background campaign. Establish a useful normal run first, then use the same selected artifact and explicit context for a bounded comparison.

## Run the released experiment

Start from a trusted answer file created on this machine. The command below runs the published package, so a separate global installation is unnecessary.

```powershell
npx.cmd --yes --package=https://github.com/BigBirdReturns/aperture/releases/download/v0.4.5/bigbirdreturns-aperture-0.4.5.tgz aperture experiment answer.json
```

On Linux/macOS replace `npx.cmd` with `npx`. The controller asks for explicit experiment approval and any other permissions still required. Release 0.4.5 runs two bounded generations preserving the requested model and context, with fresh integrity and fit checks for each trial. A later refusal retains earlier results. It does not implement an automatic parameter sweep or change the model on your behalf.

## Read the result in context

The local run record distinguishes requested, completed, and failed trials. It carries the exact model-file hashes, runtime version, selected backend/device, observed GPU layers and context, native token counters, and wall-clock timing. Consult the actual result rather than treating a successfully started process as a completed experiment.

Wall-clock generation can include prompt processing. The second run can benefit from a warm filesystem cache. A first text chunk is not necessarily the first token. Two short answers are therefore insufficient to claim a decode-throughput speedup, optimal placement, or equivalent numerical behavior.

Output agreement records whether generated outputs match. It does not establish that either answer is correct. Validate a representative task separately before relying on a configuration for that task.

## Change one variable deliberately

For a controlled investigation, preserve the model revision, representation, context, prompt, requested output length, runtime, and selected device. Create a separately inspected configuration when changing a supported parameter, such as GPU-layer placement. Record the changed parameter and repeat enough trials to see ordinary variation. This is a manual method, not an automated feature of the released experiment command.

Do not force a fit by closing somebody else's service, consuming unapproved resources, reducing explicit context, or substituting a smaller checkpoint. A resource shortfall is a useful result to retain.

## Keep results private until reviewed

Run files can contain prompts, output, paths, model hashes, and device identifiers. Nothing is uploaded automatically. Release 0.4.5 can create a reduced hardware receipt with `aperture support`, but that receipt does not sanitize or replace an experiment record. Keep the complete run private, create the reduced receipt separately when hardware evidence is needed, and provide only the smallest reviewed result necessary for the support venue. See [privacy and local data](privacy.md) and [verified support](support.md).
