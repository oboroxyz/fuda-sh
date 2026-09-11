"""Select and run PR checks without depending on an installed Node toolchain."""
import argparse
import json
import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[2]
GRAPH = 'packages/subgraphs/rights'
RUST = ['packages/substreams/erc5564', 'packages/substreams/erc5564-eas-pipeline']


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True)


def manifests(root, base=None):
    paths = (git(root, 'ls-tree', '-r', '--name-only', base).splitlines() if base else
             [p.relative_to(root).as_posix() for pattern in ['apps/*/package.json', 'packages/*/package.json']
              for p in root.glob(pattern)])
    result = {}
    for path in paths:
        parts = path.split('/')
        if len(parts) != 3 or parts[0] not in ('apps', 'packages') or parts[-1] != 'package.json':
            continue
        data = json.loads(git(root, 'show', f'{base}:{path}') if base else (root / path).read_text())
        deps = set()
        for field in ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']:
            deps.update(data.get(field, {}))
        result[str(Path(path).parent)] = (data['name'], deps)
    return result


def documentation(path):
    return path.endswith('.md') or path.startswith(('docs/', '.agents/', '.claude/', '.superpowers/'))


def make_plan(root, base=None):
    current = manifests(root)
    previous = manifests(root, base) if base else current
    # No rename detection: moving a file affects both its old and new package.
    changed = git(root, 'diff', '--name-only', '--no-renames', '-z', base, '--').split('\0') if base else []
    changed = [path for path in changed if path and not documentation(path)]
    owners = set(current) | set(previous)
    touched = {owner for owner in owners if any(path.startswith(owner + '/') for path in changed)}
    if any(path.startswith(GRAPH + '/tests/fixtures/') for path in changed):
        touched.add('apps/api')  # EAS codec tests consume shared wire payloads.
    known = (*owners, GRAPH, *RUST)
    full = base is None or any(not any(path.startswith(owner + '/') for owner in known) for path in changed)
    # Both graphs matter when a package or dependency is removed in the PR.
    affected_names = {name for graph in [current, previous] for path, (name, _) in graph.items() if path in touched}
    while True:
        consumers = {name for graph in [current, previous] for name, deps in graph.values() if deps & affected_names}
        expanded = affected_names | consumers
        if expanded == affected_names:
            break
        affected_names = expanded
    packages = sorted(path for path, (name, _) in current.items() if full or name in affected_names)
    rust = [path for path in RUST if full or any(file.startswith(path + '/') for file in changed)]
    if RUST[0] in rust and RUST[1] not in rust:
        rust.append(RUST[1])  # The pipeline compiles erc5564/proto/erc5564.proto.
    return {
        'full': full,
        'packages': packages,
        'rust': rust,
        'subgraph': full or any(path.startswith(GRAPH + '/') or path == 'apps/api/wrangler.jsonc' for path in changed),
    }


def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    plan = sub.add_parser('plan')
    plan.add_argument('base', nargs='?')
    check = sub.add_parser('check')
    check.add_argument('plan_file')
    package = sub.add_parser('package')
    package.add_argument('path')
    args = parser.parse_args()
    if args.command == 'plan':
        result = make_plan(ROOT, args.base)
        print(json.dumps(result))
        if output := os.environ.get('GITHUB_OUTPUT'):
            with open(output, 'a') as file:
                for key, value in result.items():
                    file.write(f'{key}={json.dumps(value)}\n')
    elif args.command == 'check':
        result = json.loads(Path(args.plan_file).read_text())
        if result['full']:
            run('pnpm', 'check', '--no-fmt')
        else:
            paths = result['packages'] + ([GRAPH + '/scripts'] if result['subgraph'] else [])
            if paths:
                run('pnpm', 'check', '--no-fmt', *paths)
    else:
        path = args.path
        if path not in manifests(ROOT):
            parser.error('package path must be a current workspace package')
        data = json.loads((ROOT / path / 'package.json').read_text())
        scripts = data.get('scripts', {})
        if 'test' in scripts:
            run('pnpm', '--filter', './' + path, 'run', 'test')
        if path == 'apps/api':
            run('pnpm', '--filter', 'api', 'run', 'test:scripts')
        # app's test and ens-contracts' test already include their builds.
        if path in ('apps/dash', 'apps/gate'):
            run('pnpm', '--filter', './' + path, 'run', 'build')


if __name__ == '__main__':
    main()
