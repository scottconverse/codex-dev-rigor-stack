using System;
using System.Collections.Generic;
using System.Linq;

namespace DevRigorStack.Desktop
{
    internal static class ActivatorIntegrationSelfTest
    {
        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        public static int Main(string[] args)
        {
            try
            {
                string cwd = args.Length > 0 ? args[0] : Environment.CurrentDirectory;
                string home = Environment.GetEnvironmentVariable("CODEX_HOME");
                Check(!String.IsNullOrWhiteSpace(home), "The integration test requires an isolated CODEX_HOME.");
                Check(OwnershipRules.RuntimeFailure(home).Length == 0, "The production hook runtime is not executable.");

                List<HookRecord> reviewed;
                using (CodexAppServerSession first = new CodexAppServerSession())
                {
                    HookListResult listed = first.ListHooks(cwd, 2);
                    reviewed = OwnershipRules.FilterOwned(listed.Hooks, home);
                    Check(listed.Errors.Count == 0, "Codex returned hook errors before trust.");
                    Check(OwnershipRules.IsExactOwnedSet(reviewed), "The exact seven-hook production set was not listed.");
                    first.TrustHooks(reviewed);
                }

                // A second session starts a fresh app-server process. This proves the write
                // persisted beyond the process that performed it, matching a Desktop restart.
                using (CodexAppServerSession second = new CodexAppServerSession())
                {
                    HookListResult relisted = second.ListHooks(cwd, 2);
                    List<HookRecord> verified = OwnershipRules.FilterOwned(relisted.Hooks, home);
                    Check(relisted.Errors.Count == 0, "Codex returned hook errors after trust.");
                    Check(OwnershipRules.IsExactOwnedSet(verified), "The exact seven-hook set changed after trust.");
                    Check(verified.All(h => String.Equals(h.TrustStatus, "trusted", StringComparison.OrdinalIgnoreCase)),
                        "At least one hook was not trusted in the fresh app-server process.");
                }

                Console.WriteLine("Activator integration self-test: 7/7 trusted in a fresh app-server process");
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("Activator integration self-test FAILED: " + error);
                return 1;
            }
        }
    }
}
