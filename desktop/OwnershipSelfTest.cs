using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace DevRigorStack.Desktop
{
    internal static class OwnershipSelfTest
    {
        private static int _failures;

        private static void Check(bool condition, string message)
        {
            if (condition) return;
            Console.Error.WriteLine("FAIL: " + message);
            _failures++;
        }

        private static HookRecord Hook(string home, string eventName, string script, string suffix)
        {
            string matcher = eventName == "sessionStart" ? "startup|resume|clear|compact" :
                eventName == "postToolUse" ? "^(Bash|PowerShell|apply_patch|Edit|Write|MultiEdit|NotebookEdit|mcp__.*(preview|browser|chrome|computer|screenshot|navigate|snapshot|exec|run|test|shell|terminal|jupyter|notebook|ide|eval).*)$" : "";
            string status = eventName == "sessionStart" || eventName == "subagentStart" ? "Loading active dev-rigor reflex" :
                eventName == "userPromptSubmit" ? "Routing dev-rigor protocol" :
                eventName == "stop" ? "Checking dev-rigor evidence" :
                eventName == "subagentStop" ? "Checking subagent evidence" : "";
            return new HookRecord
            {
                Key = Path.Combine(home, "hooks.json") + ":" + eventName,
                EventName = eventName,
                HandlerType = "command",
                Command = OwnershipRules.BuildIntegrityCommand(home, script, suffix, false),
                SourcePath = Path.Combine(home, "hooks.json"),
                Source = "user",
                CurrentHash = "sha256:test",
                TrustStatus = "untrusted",
                Matcher = matcher,
                TimeoutSec = 5,
                Enabled = true,
                StatusMessage = status
            };
        }

        public static int Main()
        {
            var relayLaunch = new CodexLaunch
            {
                FileName = "C:\\Program Files\\Codex Desktop\\codex.exe",
                ArgumentList = new[] { "app-server", "--listen", "stdio://" }
            };
            System.Diagnostics.ProcessStartInfo relay = CodexAppServerSession.CreateRelayStart(relayLaunch);
            Check(relay.FileName == "node", "app-server must launch through the console-independent byte relay");
            Check(relay.Arguments.Contains("eval(Buffer.from"), "byte relay must be embedded without a separate mutable script");
            Check(relay.RedirectStandardInput && relay.RedirectStandardOutput && relay.RedirectStandardError,
                "byte relay must preserve all three app-server protocol streams");
            CodexLaunch commandShim = CodexAppServerSession.CreateLaunch("C:\\Program Files\\Codex CLI\\codex.cmd");
            Check(commandShim.WindowsVerbatimArguments, "Windows command shims must preserve cmd.exe quoting verbatim");
            Check(commandShim.ArgumentList.Length == 4 && commandShim.ArgumentList[3].StartsWith("\"\"C:\\Program Files"),
                "Windows command shims must keep a spaced executable path inside cmd.exe's outer quote pair");
            string home = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "dev-rigor-ownership-test", ".codex"));
            string hookDirectory = Path.Combine(home, "dev-rigor-stack", "hooks");
            Directory.CreateDirectory(hookDirectory);
            File.WriteAllText(Path.Combine(hookDirectory, "dev-rigor-activate.js"), "// activate self-test\n");
            File.WriteAllText(Path.Combine(hookDirectory, "dev-rigor-router.js"), "// router self-test\n");
            File.WriteAllText(Path.Combine(hookDirectory, "dev-rigor-ground.js"), "// ground self-test\n");
            var exact = new List<HookRecord>
            {
                Hook(home, "sessionStart", "dev-rigor-activate.js", ""),
                Hook(home, "subagentStart", "dev-rigor-activate.js", " subagent"),
                Hook(home, "userPromptSubmit", "dev-rigor-router.js", ""),
                Hook(home, "postToolUse", "dev-rigor-ground.js", " record"),
                Hook(home, "stop", "dev-rigor-ground.js", " check"),
                Hook(home, "subagentStop", "dev-rigor-ground.js", " check")
            };

            List<HookRecord> filtered = OwnershipRules.FilterOwned(exact, home);
            Check(OwnershipRules.IsExactOwnedSet(filtered), "exact six-hook set must be accepted");

            var lookalike = new List<HookRecord>(exact);
            lookalike[0] = Hook(home, "sessionStart", "dev-rigor-activate.js", "");
            lookalike[0].Command = "node \"C:\\Temp\\dev-rigor-stack\\hooks\\dev-rigor-activate.js\"";
            Check(OwnershipRules.FilterOwned(lookalike, home).Count == 5, "lookalike command must be rejected");

            var foreign = new List<HookRecord>(exact);
            foreign[0] = Hook(home, "sessionStart", "dev-rigor-activate.js", "");
            foreign[0].SourcePath = Path.Combine(home, "project-hooks.json");
            Check(OwnershipRules.FilterOwned(foreign, home).Count == 5, "foreign source must be rejected");

            var injectedSuffix = new List<HookRecord>(exact);
            injectedSuffix[0] = Hook(home, "sessionStart", "dev-rigor-activate.js", " & malicious.exe");
            Check(OwnershipRules.FilterOwned(injectedSuffix, home).Count == 5, "injected command suffix must be rejected");

            var disabledMatcher = new List<HookRecord>(exact);
            disabledMatcher[0] = Hook(home, "sessionStart", "dev-rigor-activate.js", "");
            disabledMatcher[0].Matcher = "^never$";
            Check(OwnershipRules.FilterOwned(disabledMatcher, home).Count == 5, "disabled matcher must be rejected");

            var disabled = new List<HookRecord>(exact);
            disabled[0] = Hook(home, "sessionStart", "dev-rigor-activate.js", "");
            disabled[0].Enabled = false;
            Check(OwnershipRules.FilterOwned(disabled, home).Count == 5, "disabled hook must be rejected");

            var wrongHandler = new List<HookRecord>(exact);
            wrongHandler[0] = Hook(home, "sessionStart", "dev-rigor-activate.js", "");
            wrongHandler[0].HandlerType = "prompt";
            Check(OwnershipRules.FilterOwned(wrongHandler, home).Count == 5, "wrong handler type must be rejected");

            var wrongTimeout = new List<HookRecord>(exact);
            wrongTimeout[0] = Hook(home, "sessionStart", "dev-rigor-activate.js", "");
            wrongTimeout[0].TimeoutSec = 0;
            Check(OwnershipRules.FilterOwned(wrongTimeout, home).Count == 5, "wrong timeout must be rejected");

            var duplicate = new List<HookRecord>(exact);
            duplicate[5] = Hook(home, "stop", "dev-rigor-ground.js", " check");
            Check(!OwnershipRules.IsExactOwnedSet(duplicate), "duplicate event set must be rejected");

            var missingHash = new List<HookRecord>(exact);
            missingHash[0] = Hook(home, "sessionStart", "dev-rigor-activate.js", "");
            missingHash[0].CurrentHash = "";
            Check(!OwnershipRules.IsExactOwnedSet(missingHash), "missing current hash must be rejected");

            string missingRuntime = Path.Combine(Path.GetTempPath(), "dev-rigor-missing-runtime-" + Guid.NewGuid().ToString("N"));
            string runtimeFailure = OwnershipRules.RuntimeFailure(missingRuntime);
            Check(runtimeFailure.Contains("not installed"), "missing runtime files must prevent verified activation");

            File.AppendAllText(Path.Combine(hookDirectory, "dev-rigor-activate.js"), "// changed after definition review\n");
            Check(OwnershipRules.FilterOwned(exact, home).Count == 4, "changed runtime bytes must invalidate every affected owned definition");

            if (_failures == 0) Console.WriteLine("Ownership self-test: all adversarial cases passed");
            return _failures == 0 ? 0 : 1;
        }
    }
}
