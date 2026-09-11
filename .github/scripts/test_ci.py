"""Regression tests for CI selection using a real temporary Git repository."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.email', 'ci@example.invalid')
        self.git('config', 'user.name', 'CI fixture')
        for path, name, deps in [
            ('packages/sdk', 'sdk', {}),
            ('packages/libs', 'libs', {'sdk': 'workspace:*'}),
            ('apps/app', 'app', {'libs': 'workspace:*'}),
            ('apps/dash', 'dash', {'sdk': 'workspace:*'}),
            ('apps/api', 'api', {'sdk': 'workspace:*'}),
        ]:
            self.write(path + '/package.json', json.dumps({'name': name, 'dependencies': deps}))
            self.write(path + '/src/code.ts', 'export const value = 1\n')
        self.write('packages/subgraphs/rights/package.json', '{"name":"graph"}')
        self.write('packages/substreams/erc5564/Cargo.toml', '[package]')
        self.write('packages/substreams/erc5564-eas-pipeline/Cargo.toml', '[package]')
        self.write('README.md', '# fixture\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'base')
        self.base = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, text=True)

    def write(self, path, content='changed\n'):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def plan(self):
        # A merge checkout contains tracked changes, not local untracked paths.
        self.git('add', '-A')
        spec = importlib.util.spec_from_file_location('ci', Path(__file__).with_name('ci.py'))
        self.assertTrue(Path(spec.origin).exists(), 'CI planner must exist')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.make_plan(self.root, self.base)

    def test_frontend_change_does_not_run_sibling_tests(self):
        self.write('apps/dash/src/code.ts')
        self.assertEqual(self.plan()['packages'], ['apps/dash'])

    def test_sdk_change_includes_transitive_consumers(self):
        self.write('packages/sdk/src/code.ts')
        self.assertEqual(self.plan()['packages'],
                         ['apps/api', 'apps/app', 'apps/dash', 'packages/libs', 'packages/sdk'])

    def test_docs_only_need_format(self):
        self.write('apps/app/README.md')
        plan = self.plan()
        self.assertEqual(plan['packages'], [])
        self.assertFalse(plan['subgraph'])
        self.assertEqual(plan['rust'], [])

    def test_deleted_package_still_checks_previous_consumers(self):
        self.git('rm', '-r', 'packages/sdk')
        self.assertEqual(self.plan()['packages'],
                         ['apps/api', 'apps/app', 'apps/dash', 'packages/libs'])

    def test_renamed_file_checks_both_packages(self):
        self.git('mv', 'apps/app/src/code.ts', 'apps/dash/src/moved.ts')
        self.assertEqual(self.plan()['packages'], ['apps/app', 'apps/dash'])

    def test_global_lockfile_change_runs_every_lane(self):
        self.write('pnpm-lock.yaml')
        plan = self.plan()
        self.assertTrue(plan['full'])
        self.assertEqual(len(plan['packages']), 5)
        self.assertTrue(plan['subgraph'])
        self.assertEqual(plan['rust'], ['packages/substreams/erc5564',
                                        'packages/substreams/erc5564-eas-pipeline'])

    def test_shared_proto_change_checks_pipeline(self):
        self.write('packages/substreams/erc5564/proto/erc5564.proto')
        plan = self.plan()
        self.assertEqual(plan['packages'], [])
        self.assertEqual(len(plan['rust']), 2)

    def test_api_configuration_checks_subgraph_generation(self):
        self.write('apps/api/wrangler.jsonc')
        plan = self.plan()
        self.assertEqual(plan['packages'], ['apps/api'])
        self.assertTrue(plan['subgraph'])

    def test_shared_subgraph_fixture_runs_api_wire_compatibility(self):
        self.write('packages/subgraphs/rights/tests/fixtures/eas-payloads.ts')
        plan = self.plan()
        self.assertEqual(plan['packages'], ['apps/api'])
        self.assertTrue(plan['subgraph'])

    def test_independent_graph_change_does_not_run_workspace_tests(self):
        self.write('packages/subgraphs/rights/src/mapping.ts')
        plan = self.plan()
        self.assertEqual(plan['packages'], [])
        self.assertTrue(plan['subgraph'])

    def test_unknown_executable_input_fails_safe_to_full(self):
        self.write('new-build-script.sh')
        self.assertTrue(self.plan()['full'])

    def test_dependency_removal_uses_previous_graph(self):
        self.write('packages/libs/package.json', '{"name":"libs"}')
        self.write('packages/sdk/src/code.ts')
        self.assertIn('apps/app', self.plan()['packages'])

    def test_invalid_base_fails_instead_of_skipping_ci(self):
        self.base = 'missing-ref'
        with self.assertRaises(subprocess.CalledProcessError):
            self.plan()


if __name__ == '__main__':
    unittest.main()
