using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace DevRigorStack.Desktop
{
    internal static class ActivatorUiSelfTest
    {
        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static HookRecord Copy(HookRecord source, string trustStatus)
        {
            return new HookRecord
            {
                Key = source.Key,
                EventName = source.EventName,
                HandlerType = source.HandlerType,
                Command = source.Command,
                SourcePath = source.SourcePath,
                Source = source.Source,
                CurrentHash = source.CurrentHash,
                TrustStatus = trustStatus,
                Matcher = source.Matcher,
                TimeoutSec = source.TimeoutSec,
                Enabled = source.Enabled,
                StatusMessage = source.StatusMessage
            };
        }

        private static HookListResult Result(IEnumerable<HookRecord> hooks, string trustStatus)
        {
            HookListResult result = new HookListResult();
            result.Hooks.AddRange(hooks.Select(hook => Copy(hook, trustStatus)));
            return result;
        }

        private static void PumpUntil(Func<bool> completed, string failure)
        {
            DateTime deadline = DateTime.UtcNow.AddSeconds(5);
            while (!completed() && DateTime.UtcNow < deadline)
            {
                Application.DoEvents();
                Thread.Sleep(10);
            }
            Check(completed(), failure);
        }

        [STAThread]
        public static int Main(string[] args)
        {
            try
            {
                string cwd = args.Length > 0 ? args[0] : Environment.CurrentDirectory;
                List<HookRecord> exact;
                using (CodexAppServerSession session = new CodexAppServerSession())
                {
                    HookListResult listed = session.ListHooks(cwd, 2);
                    exact = OwnershipRules.FilterOwned(
                        listed.Hooks,
                        Environment.GetEnvironmentVariable("CODEX_HOME")
                    );
                }
                Check(OwnershipRules.IsExactOwnedSet(exact), "The UI self-test requires the exact installed six-hook set.");

                HookListResult untrusted = Result(exact, "changed");
                int reviewCalls = 0;
                int trustCalls = 0;
                using (ActivatorForm form = new ActivatorForm(
                    delegate { return untrusted; },
                    delegate(List<HookRecord> reviewed)
                    {
                        trustCalls++;
                        Check(OwnershipRules.IsExactOwnedSet(reviewed), "The button did not submit the exact six-hook set.");
                        return Result(reviewed, "trusted");
                    },
                    delegate(IWin32Window owner, string review)
                    {
                        reviewCalls++;
                        Check(review.Contains("Hash:"), "The confirmation omitted the reviewed hashes.");
                        Check(OwnershipRules.ExpectedEvents.All(name =>
                            review.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0 ||
                            review.IndexOf(EventText(name), StringComparison.OrdinalIgnoreCase) >= 0),
                            "The confirmation omitted a hook event.");
                        return true;
                    },
                    delegate { },
                    false))
                {
                    form.ShowInTaskbar = false;
                    form.Opacity = 0;
                    form.Show();
                    Application.DoEvents();
                    IntPtr handle = form.Handle;
                    form.ApplyHookListForTest(untrusted);
                    Check(form.TrustEnabledForTest, "The trust button was not enabled for six changed hooks.");
                    form.PerformTrustClickForTest();
                    PumpUntil(
                        delegate { return trustCalls == 1 && form.StatusForTest == "Activation verified after the trust write."; },
                        "The Trust button did not execute and verify the injected trust path."
                    );
                    Check(reviewCalls == 1, "The Trust button bypassed or repeated the review confirmation.");
                    Check(!form.TrustEnabledForTest, "The Trust button remained enabled after verification.");
                }

                int canceledTrustCalls = 0;
                using (ActivatorForm canceled = new ActivatorForm(
                    delegate { return untrusted; },
                    delegate(List<HookRecord> reviewed)
                    {
                        canceledTrustCalls++;
                        return Result(reviewed, "trusted");
                    },
                    delegate { return false; },
                    delegate { },
                    false))
                {
                    canceled.ShowInTaskbar = false;
                    canceled.Opacity = 0;
                    canceled.Show();
                    Application.DoEvents();
                    IntPtr handle = canceled.Handle;
                    canceled.ApplyHookListForTest(untrusted);
                    canceled.PerformTrustClickForTest();
                    Application.DoEvents();
                    Check(canceledTrustCalls == 0, "Canceling the review still invoked trust.");
                    Check(canceled.TrustEnabledForTest, "Canceling changed the available trust action.");
                }

                HookListResult incomplete = Result(exact.Take(5), "changed");
                int incompleteReviewCalls = 0;
                using (ActivatorForm missing = new ActivatorForm(
                    delegate { return incomplete; },
                    delegate(List<HookRecord> reviewed) { throw new InvalidOperationException("incomplete set reached trust"); },
                    delegate { incompleteReviewCalls++; return true; },
                    delegate { },
                    false))
                {
                    missing.ShowInTaskbar = false;
                    missing.Opacity = 0;
                    missing.Show();
                    Application.DoEvents();
                    IntPtr handle = missing.Handle;
                    missing.ApplyHookListForTest(incomplete);
                    Check(!missing.TrustEnabledForTest, "An incomplete hook set enabled trust.");
                    missing.PerformTrustClickForTest();
                    Application.DoEvents();
                    Check(incompleteReviewCalls == 0, "An incomplete hook set reached review.");
                }

                int loadFailures = 0;
                using (ActivatorForm failedLoad = new ActivatorForm(
                    delegate { throw new InvalidOperationException("injected list failure"); },
                    delegate(List<HookRecord> reviewed) { throw new InvalidOperationException("failed load reached trust"); },
                    delegate { return true; },
                    delegate(IWin32Window owner, string message)
                    {
                        loadFailures++;
                        Check(message.Contains("injected list failure"), "The load error lost its actionable details.");
                    },
                    true))
                {
                    failedLoad.ShowInTaskbar = false;
                    failedLoad.Opacity = 0;
                    failedLoad.Show();
                    PumpUntil(delegate { return loadFailures == 1; }, "An asynchronous list failure was not reported.");
                    Check(!failedLoad.TrustEnabledForTest, "A failed list operation enabled trust.");
                    Check(failedLoad.StatusForTest.Contains("No trust settings were changed"), "A failed list operation did not preserve the safety state.");
                }

                int trustFailures = 0;
                using (ActivatorForm failedTrust = new ActivatorForm(
                    delegate { return untrusted; },
                    delegate(List<HookRecord> reviewed) { throw new InvalidOperationException("injected trust failure"); },
                    delegate { return true; },
                    delegate(IWin32Window owner, string message)
                    {
                        trustFailures++;
                        Check(message.Contains("injected trust failure"), "The trust error lost its actionable details.");
                    },
                    false))
                {
                    failedTrust.ShowInTaskbar = false;
                    failedTrust.Opacity = 0;
                    failedTrust.Show();
                    Application.DoEvents();
                    failedTrust.ApplyHookListForTest(untrusted);
                    failedTrust.PerformTrustClickForTest();
                    PumpUntil(delegate { return trustFailures == 1; }, "An asynchronous trust failure was not reported.");
                    Check(!failedTrust.TrustEnabledForTest, "A failed trust operation left the trust button enabled.");
                    Check(failedTrust.StatusForTest.Contains("No trust settings were changed"), "A failed trust operation did not preserve the safety state.");
                }

                Console.WriteLine("Activator UI self-test: Trust click, safe cancel, incomplete-set refusal, async failures, and verified completion passed");
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("Activator UI self-test FAILED: " + error);
                return 1;
            }
        }

        private static string EventText(string eventName)
        {
            switch (eventName)
            {
                case "sessionStart": return "Task starts";
                case "subagentStart": return "Subagent starts";
                case "userPromptSubmit": return "You send a prompt";
                case "postToolUse": return "A change or UI action runs";
                case "stop": return "Codex tries to stop";
                case "subagentStop": return "A subagent tries to stop";
                default: return eventName;
            }
        }
    }
}
