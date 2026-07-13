using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Dev Rigor Stack Codex Desktop Hook Activator")]
[assembly: AssemblyDescription("Graphical review and activation of the Dev Rigor safeguards in Codex Desktop")]
[assembly: AssemblyCompany("Scott Converse")]
[assembly: AssemblyProduct("Dev Rigor Stack")]
[assembly: AssemblyCopyright("Copyright © 2026 Scott Converse")]
[assembly: AssemblyVersion("1.7.0.0")]
[assembly: AssemblyFileVersion("1.7.0.0")]
[assembly: AssemblyInformationalVersion("1.7.0")]

namespace DevRigorStack.Desktop
{
    internal sealed class HookRecord
    {
        public string Key;
        public string EventName;
        public string HandlerType;
        public string Command;
        public string SourcePath;
        public string Source;
        public string CurrentHash;
        public string TrustStatus;
        public string Matcher;
        public int TimeoutSec;
        public bool Enabled;
        public string StatusMessage;
    }

    internal sealed class HookListResult
    {
        public readonly List<HookRecord> Hooks = new List<HookRecord>();
        public readonly List<string> Warnings = new List<string>();
        public readonly List<string> Errors = new List<string>();
    }

    internal sealed class CodexLaunch
    {
        public string FileName;
        public string[] ArgumentList;
        public bool WindowsVerbatimArguments;
    }

    internal static class OwnershipRules
    {
        public const int ExpectedHookCount = 6;
        public static readonly string[] ExpectedEvents =
        {
            "sessionStart", "subagentStart", "userPromptSubmit", "postToolUse", "stop", "subagentStop"
        };

        public static List<HookRecord> FilterOwned(IEnumerable<HookRecord> hooks, string codexHome)
        {
            if (String.IsNullOrWhiteSpace(codexHome))
                codexHome = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
            string expectedSource = Path.GetFullPath(Path.Combine(codexHome, "hooks.json"));
            return hooks.Where(h => IsOwned(h, codexHome, expectedSource)).ToList();
        }

        public static bool IsExactOwnedSet(List<HookRecord> hooks)
        {
            if (hooks == null || hooks.Count != ExpectedHookCount) return false;
            return ExpectedEvents.All(expected => hooks.Count(h => h.EventName == expected) == 1) &&
                   hooks.All(h => !String.IsNullOrWhiteSpace(h.Key) && !String.IsNullOrWhiteSpace(h.CurrentHash));
        }

        public static string RuntimeFailure(string codexHome)
        {
            if (String.IsNullOrWhiteSpace(codexHome))
                codexHome = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
            string hooksDirectory = Path.Combine(codexHome, "dev-rigor-stack", "hooks");
            foreach (string script in new[] { "dev-rigor-activate.js", "dev-rigor-router.js", "dev-rigor-ground.js" })
            {
                if (!File.Exists(Path.Combine(hooksDirectory, script)))
                    return "The Dev Rigor hook runtime is not installed completely. Ask Codex Desktop to reinstall dev-rigor-stack 1.7.0, then reopen this app.";
            }

            try
            {
                using (Process node = new Process())
                {
                    node.StartInfo = new ProcessStartInfo
                    {
                        FileName = "node",
                        Arguments = "--version",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true
                    };
                    if (!node.Start()) return "Node.js could not be started. Ask Codex Desktop to reinstall the Dev Rigor hook runtime.";
                    if (!node.WaitForExit(5000))
                    {
                        try { node.Kill(); } catch { }
                        return "Node.js did not respond. Restart Codex Desktop, then reopen this app.";
                    }
                    if (node.ExitCode != 0)
                        return "Node.js could not run the installed hooks. Ask Codex Desktop to repair the Dev Rigor installation.";
                }
            }
            catch (Exception error)
            {
                return "Node.js is not available to run the installed hooks (" + error.Message + "). Ask Codex Desktop to repair the Dev Rigor installation.";
            }
            return String.Empty;
        }

        public static string BuildIntegrityCommand(string codexHome, string script, string suffix, bool portable)
        {
            string scriptPath = Path.Combine(codexHome, "dev-rigor-stack", "hooks", script);
            string commandPath = portable ? scriptPath.Replace('\\', '/') : scriptPath;
            byte[] content = File.ReadAllBytes(scriptPath);
            byte[] digest;
            using (SHA256 sha = SHA256.Create()) digest = sha.ComputeHash(content);
            string hash = BitConverter.ToString(digest).Replace("-", "").ToLowerInvariant();
            string encodedPath = Convert.ToBase64String(Encoding.UTF8.GetBytes(commandPath));
            string loader = "const f=Buffer.from('" + encodedPath + "','base64').toString(),b=require('fs').readFileSync(f);" +
                "if(require('crypto').createHash('sha256').update(b).digest('hex')!=='" + hash + "')" +
                "{console.error('Dev Rigor hook integrity check failed: '+f);process.exit(2)}" +
                "const M=require('module'),m=new M(f,module);m.filename=f;m.paths=M._nodeModulePaths(require('path').dirname(f));" +
                "process.argv.splice(1,0,f);m._compile(b.toString(),f)";
            return "node -e \"" + loader + "\"" + suffix;
        }

        private static bool IsOwned(HookRecord hook, string codexHome, string expectedSource)
        {
            if (hook == null || String.IsNullOrWhiteSpace(hook.SourcePath) || String.IsNullOrWhiteSpace(hook.Command))
                return false;
            string source;
            try { source = Path.GetFullPath(hook.SourcePath); }
            catch { return false; }
            if (!String.Equals(source, expectedSource, StringComparison.OrdinalIgnoreCase)) return false;

            string script;
            string suffix;
            string expectedMatcher;
            string expectedStatus;
            switch (hook.EventName)
            {
                case "sessionStart":
                    script = "dev-rigor-activate.js"; suffix = "";
                    expectedMatcher = "startup|resume|clear|compact";
                    expectedStatus = "Loading active dev-rigor reflex";
                    break;
                case "subagentStart":
                    script = "dev-rigor-activate.js"; suffix = " subagent";
                    expectedMatcher = "";
                    expectedStatus = "Loading active dev-rigor reflex";
                    break;
                case "userPromptSubmit":
                    script = "dev-rigor-router.js"; suffix = "";
                    expectedMatcher = "";
                    expectedStatus = "Routing dev-rigor protocol";
                    break;
                case "postToolUse":
                    script = "dev-rigor-ground.js"; suffix = " record";
                    expectedMatcher = "^(Bash|PowerShell|apply_patch|Edit|Write|MultiEdit|NotebookEdit|mcp__.*(preview|browser|chrome|computer|screenshot|navigate|snapshot|exec|run|test|shell|terminal|jupyter|notebook|ide|eval).*)$";
                    expectedStatus = "";
                    break;
                case "stop":
                    script = "dev-rigor-ground.js"; suffix = " check";
                    expectedMatcher = "";
                    expectedStatus = "Checking dev-rigor evidence";
                    break;
                case "subagentStop":
                    script = "dev-rigor-ground.js"; suffix = " check";
                    expectedMatcher = "";
                    expectedStatus = "Checking subagent evidence";
                    break;
                default: return false;
            }

            if (!String.Equals(hook.HandlerType, "command", StringComparison.OrdinalIgnoreCase) ||
                !String.Equals(hook.Source, "user", StringComparison.OrdinalIgnoreCase) ||
                !hook.Enabled || hook.TimeoutSec != 5 ||
                !String.Equals(hook.Matcher ?? "", expectedMatcher, StringComparison.Ordinal) ||
                !String.Equals(hook.StatusMessage ?? "", expectedStatus, StringComparison.Ordinal))
                return false;

            string nativeCommand;
            string portableCommand;
            try
            {
                nativeCommand = BuildIntegrityCommand(codexHome, script, suffix, false);
                portableCommand = BuildIntegrityCommand(codexHome, script, suffix, true);
            }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
            return String.Equals(hook.Command, nativeCommand, StringComparison.OrdinalIgnoreCase) ||
                   String.Equals(hook.Command, portableCommand, StringComparison.OrdinalIgnoreCase);
        }
    }

    internal sealed class CodexAppServerSession : IDisposable
    {
        private const int ResponseTimeoutMilliseconds = 15000;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
        private readonly Process _process;
        private readonly StreamWriter _standardInput;
        private readonly List<string> _standardError = new List<string>();
        private readonly BlockingCollection<string> _standardOutput = new BlockingCollection<string>();

        public CodexAppServerSession()
        {
            CodexLaunch launch = LocateCodex();
            ProcessStartInfo start = CreateRelayStart(launch);
            _process = new Process { StartInfo = start, EnableRaisingEvents = true };
            _process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args)
            {
                if (!String.IsNullOrWhiteSpace(args.Data))
                {
                    lock (_standardError) _standardError.Add(args.Data);
                }
            };
            _process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args)
            {
                if (args.Data == null)
                {
                    _standardOutput.CompleteAdding();
                    return;
                }
                if (!_standardOutput.IsAddingCompleted) _standardOutput.Add(args.Data);
            };
            if (!_process.Start()) throw new InvalidOperationException("Codex could not be started.");
            _standardInput = _process.StandardInput;
            _process.BeginErrorReadLine();
            _process.BeginOutputReadLine();
            Initialize();
        }

        private static CodexLaunch LocateCodex()
        {
            string forced = Environment.GetEnvironmentVariable("DEV_RIGOR_CODEX_EXE");
            if (!String.IsNullOrWhiteSpace(forced) && File.Exists(forced)) return CreateLaunch(forced);

            // Codex Desktop maintains a directly executable app-server runtime here even
            // when the user has never installed a CLI or added anything to PATH.
            string localData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string desktopBin = Path.Combine(localData, "OpenAI", "Codex", "bin");
            try
            {
                string desktopRuntime = Directory.Exists(desktopBin)
                    ? Directory.GetFiles(desktopBin, "codex.exe", SearchOption.AllDirectories)
                        .OrderByDescending(File.GetLastWriteTimeUtc)
                        .FirstOrDefault()
                    : null;
                if (!String.IsNullOrWhiteSpace(desktopRuntime)) return CreateLaunch(desktopRuntime);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }

            string path = Environment.GetEnvironmentVariable("PATH") ?? String.Empty;
            foreach (string directory in path.Split(Path.PathSeparator))
            {
                string clean = directory.Trim().Trim('"');
                if (clean.Length == 0) continue;
                foreach (string name in new[] { "codex.exe", "codex.cmd", "codex.bat" })
                {
                    string candidate;
                    try { candidate = Path.Combine(clean, name); }
                    catch { continue; }
                    if (File.Exists(candidate)) return CreateLaunch(candidate);
                }
            }

            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            foreach (string name in new[] { "codex.exe", "codex.cmd", "codex.bat" })
            {
                string candidate = Path.Combine(appData, "npm", name);
                if (File.Exists(candidate)) return CreateLaunch(candidate);
            }

            throw new FileNotFoundException(
                "Codex Desktop's local Codex runtime was not found. Update or reinstall Codex Desktop, then reopen this activator."
            );
        }

        internal static CodexLaunch CreateLaunch(string path)
        {
            string extension = Path.GetExtension(path).ToLowerInvariant();
            if (extension == ".cmd" || extension == ".bat")
            {
                return new CodexLaunch
                {
                    FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe",
                    ArgumentList = new[] { "/d", "/s", "/c", "\"\"" + path + "\" app-server --listen stdio://\"" },
                    WindowsVerbatimArguments = true
                };
            }
            return new CodexLaunch
            {
                FileName = path,
                ArgumentList = new[] { "app-server", "--listen", "stdio://" }
            };
        }

        internal static ProcessStartInfo CreateRelayStart(CodexLaunch launch)
        {
            // .NET Framework prefixes Process.StandardInput with a UTF-8 BOM. Codex's
            // JSONL app-server correctly rejects those bytes before the first JSON object.
            // A hidden Node relay removes only that leading BOM and then forwards raw
            // stdin/stdout/stderr. This works in the real /target:winexe process, where
            // Process-wide console encodings cannot be accessed because no console handle exists.
            var spec = new Dictionary<string, object>
            {
                { "file", launch.FileName },
                { "args", launch.ArgumentList },
                { "verbatim", launch.WindowsVerbatimArguments }
            };
            string specJson = new JavaScriptSerializer().Serialize(spec);
            string specBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(specJson));
            string relay =
                "const{spawn}=require('child_process');" +
                "const s=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8'));" +
                "const c=spawn(s.file,s.args,{stdio:['pipe','pipe','pipe'],windowsHide:true,windowsVerbatimArguments:!!s.verbatim});" +
                "let first=true,prefix=Buffer.alloc(0);" +
                "process.stdin.on('data',d=>{" +
                "if(first){prefix=Buffer.concat([prefix,d]);if(prefix.length<3)return;first=false;" +
                "d=prefix[0]===0xef&&prefix[1]===0xbb&&prefix[2]===0xbf?prefix.subarray(3):prefix;}" +
                "if(d.length)c.stdin.write(d);});" +
                "process.stdin.on('end',()=>{if(first&&prefix.length)c.stdin.write(prefix);c.stdin.end();});" +
                "c.stdout.pipe(process.stdout);c.stderr.pipe(process.stderr);" +
                "c.on('error',e=>{console.error('Codex relay launch failed: '+e.message);process.exit(1);});" +
                "c.on('exit',code=>process.exit(code==null?1:code));";
            string relayBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(relay));
            return new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "-e \"eval(Buffer.from('" + relayBase64 + "','base64').toString('utf8'))\" " + specBase64,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = Environment.CurrentDirectory
            };
        }

        private void Initialize()
        {
            var clientInfo = new Dictionary<string, object>
            {
                { "name", "dev_rigor_hook_activator" },
                { "title", "Dev Rigor Hook Activator" },
                { "version", "1.7.0" }
            };
            Request("initialize", 1, new Dictionary<string, object> { { "clientInfo", clientInfo } });
            Notify("initialized", new Dictionary<string, object>());
        }

        public HookListResult ListHooks(string cwd, int id)
        {
            Dictionary<string, object> response = Request(
                "hooks/list",
                id,
                new Dictionary<string, object> { { "cwds", new object[] { cwd } } }
            );
            Dictionary<string, object> result = GetDictionary(response, "result");
            object[] data = GetArray(result, "data");
            if (data.Length == 0) throw new InvalidOperationException("Codex returned no hook data for this profile.");
            Dictionary<string, object> entry = data[0] as Dictionary<string, object>;
            if (entry == null) throw new InvalidOperationException("Codex returned malformed hook data.");

            HookListResult parsed = new HookListResult();
            foreach (object raw in GetArray(entry, "hooks"))
            {
                Dictionary<string, object> hook = raw as Dictionary<string, object>;
                if (hook == null) continue;
                parsed.Hooks.Add(new HookRecord
                {
                    Key = GetString(hook, "key"),
                    EventName = GetString(hook, "eventName"),
                    HandlerType = GetString(hook, "handlerType"),
                    Command = GetString(hook, "command"),
                    SourcePath = GetString(hook, "sourcePath"),
                    Source = GetString(hook, "source"),
                    CurrentHash = GetString(hook, "currentHash"),
                    TrustStatus = GetString(hook, "trustStatus"),
                    Matcher = GetString(hook, "matcher"),
                    TimeoutSec = GetInt(hook, "timeoutSec"),
                    Enabled = GetBool(hook, "enabled"),
                    StatusMessage = GetString(hook, "statusMessage")
                });
            }
            AddStrings(parsed.Warnings, GetArray(entry, "warnings"));
            AddStrings(parsed.Errors, GetArray(entry, "errors"));
            return parsed;
        }

        public void TrustHooks(IEnumerable<HookRecord> hooks)
        {
            var state = new Dictionary<string, object>();
            foreach (HookRecord hook in hooks)
            {
                state.Add(hook.Key, new Dictionary<string, object> { { "trusted_hash", hook.CurrentHash } });
            }
            var edit = new Dictionary<string, object>
            {
                { "keyPath", "hooks.state" },
                { "value", state },
                { "mergeStrategy", "upsert" }
            };
            var parameters = new Dictionary<string, object>
            {
                { "edits", new object[] { edit } },
                { "filePath", null },
                { "expectedVersion", null },
                { "reloadUserConfig", true }
            };
            Dictionary<string, object> response = Request("config/batchWrite", 3, parameters);
            Dictionary<string, object> result = GetDictionary(response, "result");
            string status = GetString(result, "status");
            if (status != "ok" && status != "okOverridden")
                throw new InvalidOperationException("Codex did not confirm the hook trust update.");
        }

        public HookListResult RefreshAndVerify(string cwd)
        {
            return ListHooks(cwd, 4);
        }

        private Dictionary<string, object> Request(string method, int id, Dictionary<string, object> parameters)
        {
            var request = new Dictionary<string, object>
            {
                { "method", method },
                { "id", id },
                { "params", parameters }
            };
            Write(request);
            DateTime deadline = DateTime.UtcNow.AddMilliseconds(ResponseTimeoutMilliseconds);
            while (DateTime.UtcNow < deadline)
            {
                int remaining = Math.Max(1, (int)(deadline - DateTime.UtcNow).TotalMilliseconds);
                string line;
                if (!_standardOutput.TryTake(out line, remaining))
                {
                    if (_process.HasExited)
                        throw new InvalidOperationException("Codex closed unexpectedly. " + ErrorSummary());
                    throw new TimeoutException("Codex did not answer " + method + " in time. " + ErrorSummary());
                }
                if (line.Trim().Length == 0) continue;
                Dictionary<string, object> message = _json.DeserializeObject(line) as Dictionary<string, object>;
                if (message == null) continue;
                object error;
                if (message.TryGetValue("error", out error))
                    throw new InvalidOperationException("Codex rejected " + method + ": " + _json.Serialize(error));
                object responseId;
                if (message.TryGetValue("id", out responseId) && Convert.ToInt32(responseId) == id) return message;
            }
            throw new TimeoutException("Codex did not answer " + method + " in time.");
        }

        private void Notify(string method, Dictionary<string, object> parameters)
        {
            Write(new Dictionary<string, object> { { "method", method }, { "params", parameters } });
        }

        private void Write(Dictionary<string, object> message)
        {
            _standardInput.WriteLine(_json.Serialize(message));
            _standardInput.Flush();
        }

        private string ErrorSummary()
        {
            lock (_standardError) return String.Join(Environment.NewLine, _standardError.ToArray());
        }

        private static Dictionary<string, object> GetDictionary(Dictionary<string, object> source, string key)
        {
            object value;
            Dictionary<string, object> dictionary;
            if (!source.TryGetValue(key, out value) || (dictionary = value as Dictionary<string, object>) == null)
                throw new InvalidOperationException("Codex response is missing " + key + ".");
            return dictionary;
        }

        private static object[] GetArray(Dictionary<string, object> source, string key)
        {
            object value;
            if (!source.TryGetValue(key, out value) || value == null) return new object[0];
            object[] array = value as object[];
            if (array != null) return array;
            System.Collections.ArrayList list = value as System.Collections.ArrayList;
            return list == null ? new object[0] : list.ToArray();
        }

        private static string GetString(Dictionary<string, object> source, string key)
        {
            object value;
            return source.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : String.Empty;
        }

        private static int GetInt(Dictionary<string, object> source, string key)
        {
            object value;
            return source.TryGetValue(key, out value) && value != null ? Convert.ToInt32(value) : 0;
        }

        private static bool GetBool(Dictionary<string, object> source, string key)
        {
            object value;
            return source.TryGetValue(key, out value) && value != null && Convert.ToBoolean(value);
        }

        private static void AddStrings(List<string> destination, object[] values)
        {
            foreach (object value in values) destination.Add(Convert.ToString(value));
        }

        public void Dispose()
        {
            try
            {
                _standardInput.Close();
            }
            catch { }
            try
            {
                if (!_process.WaitForExit(2000)) _process.Kill();
            }
            catch { }
            _process.Dispose();
        }
    }

    internal sealed class AccessibleHookGrid : DataGridView
    {
        public Control NextTabControl;
        public Control PreviousTabControl;
        public Control KeyboardReviewControl;

        protected override void OnEnter(EventArgs e)
        {
            base.OnEnter(e);
            if (KeyboardReviewControl != null)
                BeginInvoke(new Action(() => KeyboardReviewControl.Focus()));
        }

        private bool LeaveGrid(Keys keyData)
        {
            if ((keyData & Keys.KeyCode) != Keys.Tab) return false;
            bool forward = (keyData & Keys.Shift) != Keys.Shift;
            Control target = forward ? NextTabControl : PreviousTabControl;
            return target != null && target.Focus();
        }

        protected override void WndProc(ref Message message)
        {
            const int WmKeyDown = 0x0100;
            if (message.Msg == WmKeyDown && (Keys)message.WParam.ToInt32() == Keys.Tab &&
                LeaveGrid(Keys.Tab | Control.ModifierKeys)) return;
            base.WndProc(ref message);
        }

        protected override bool ProcessDialogKey(Keys keyData)
        {
            return LeaveGrid(keyData) || base.ProcessDialogKey(keyData);
        }

        protected override bool ProcessDataGridViewKey(KeyEventArgs e)
        {
            return LeaveGrid(e.KeyData) || base.ProcessDataGridViewKey(e);
        }
    }

    internal sealed class HookReviewDialog : Form
    {
        public HookReviewDialog(string review)
        {
            Text = "Review the six Dev Rigor hooks";
            StartPosition = FormStartPosition.CenterParent;
            ClientSize = new Size(900, 640);
            MinimumSize = new Size(680, 480);
            Font = new Font("Segoe UI", 9F);
            ShowIcon = false;
            MaximizeBox = true;
            MinimizeBox = false;

            TableLayoutPanel layout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(18),
                ColumnCount = 1,
                RowCount = 3
            };
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 62));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
            Controls.Add(layout);

            Label heading = new Label
            {
                Dock = DockStyle.Fill,
                Text = "Codex will trust exactly the six current definitions below. Each command verifies its script SHA-256 and executes the already-verified bytes.\r\nUpdated scripts create changed definitions that require review again.",
                AutoEllipsis = true
            };
            layout.Controls.Add(heading, 0, 0);

            TextBox content = new TextBox
            {
                Dock = DockStyle.Fill,
                Multiline = true,
                ReadOnly = true,
                WordWrap = false,
                ScrollBars = ScrollBars.Both,
                BackColor = Color.White,
                Text = review,
                AccessibleName = "Exact six-hook review details",
                AccessibleDescription = "Commands, sources, matchers, enabled states, timeouts, and current hashes for all six hooks."
            };
            layout.Controls.Add(content, 0, 1);

            Button cancel = new Button { Text = "&Cancel", DialogResult = DialogResult.Cancel, Width = 110, Height = 36 };
            Button trust = new Button { Text = "&Trust these 6 hooks", DialogResult = DialogResult.OK, Width = 180, Height = 36 };
            FlowLayoutPanel actions = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(0, 8, 0, 0)
            };
            actions.Controls.Add(cancel);
            actions.Controls.Add(trust);
            layout.Controls.Add(actions, 0, 2);
            CancelButton = cancel;
            AcceptButton = cancel;
            Shown += delegate { content.Focus(); content.SelectionLength = 0; };
        }
    }

    internal sealed class ActivatorForm : Form
    {
        private const int ExpectedHookCount = OwnershipRules.ExpectedHookCount;
        private static readonly string[] ExpectedEvents = OwnershipRules.ExpectedEvents;

        private readonly Label _summary = new Label();
        private readonly Label _status = new Label();
        private readonly AccessibleHookGrid _grid = new AccessibleHookGrid();
        private readonly ComboBox _hookSelector = new ComboBox();
        private readonly TextBox _details = new TextBox();
        private readonly Button _trust = new Button();
        private readonly Button _refresh = new Button();
        private readonly Button _close = new Button();
        private readonly Func<HookListResult> _loadFromCodex;
        private readonly Func<List<HookRecord>, HookListResult> _trustThroughCodex;
        private readonly Func<IWin32Window, string, bool> _reviewAndConfirm;
        private readonly Action<IWin32Window, string> _reportFailure;
        private readonly bool _loadOnShown;
        private List<HookRecord> _ownedHooks = new List<HookRecord>();
        private bool _busy;

        public ActivatorForm() : this(LoadFromCodex, TrustThroughCodex, ReviewAndConfirm, ReportFailure, true) { }

        internal ActivatorForm(
            Func<HookListResult> loadFromCodex,
            Func<List<HookRecord>, HookListResult> trustThroughCodex,
            Func<IWin32Window, string, bool> reviewAndConfirm,
            Action<IWin32Window, string> reportFailure,
            bool loadOnShown)
        {
            if (loadFromCodex == null) throw new ArgumentNullException("loadFromCodex");
            if (trustThroughCodex == null) throw new ArgumentNullException("trustThroughCodex");
            if (reviewAndConfirm == null) throw new ArgumentNullException("reviewAndConfirm");
            if (reportFailure == null) throw new ArgumentNullException("reportFailure");
            _loadFromCodex = loadFromCodex;
            _trustThroughCodex = trustThroughCodex;
            _reviewAndConfirm = reviewAndConfirm;
            _reportFailure = reportFailure;
            _loadOnShown = loadOnShown;
            Text = "Dev Rigor Stack — Codex Desktop Hook Activator 1.7.0";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(980, 680);
            MinimumSize = new Size(820, 600);
            BackColor = Color.FromArgb(247, 248, 250);
            Font = new Font("Segoe UI", 9F);

            TableLayoutPanel root = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(24),
                ColumnCount = 1,
                RowCount = 8,
                BackColor = BackColor
            };
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 70));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 184));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
            Controls.Add(root);

            Label title = new Label
            {
                Text = "Activate the Dev Rigor safeguards in Codex Desktop",
                Dock = DockStyle.Fill,
                Font = new Font("Segoe UI Semibold", 18F),
                ForeColor = Color.FromArgb(20, 28, 42),
                AutoEllipsis = true
            };
            root.Controls.Add(title, 0, 0);

            _summary.Text = "Checking the six installed hook definitions with Codex…\r\nUse Up and Down Arrow to select a hook; Tab moves to its exact details and the action buttons. No terminal is required.";
            _summary.Dock = DockStyle.Fill;
            _summary.ForeColor = Color.FromArgb(55, 65, 81);
            _summary.Padding = new Padding(0, 4, 0, 4);
            root.Controls.Add(_summary, 0, 1);

            ConfigureGrid();
            root.Controls.Add(_grid, 0, 2);

            TableLayoutPanel selectorRow = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 1,
                Margin = new Padding(0, 4, 0, 4)
            };
            selectorRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
            selectorRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            Label selectorLabel = new Label
            {
                Text = "Keyboard review:",
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft
            };
            _hookSelector.Dock = DockStyle.Fill;
            _hookSelector.DropDownStyle = ComboBoxStyle.DropDownList;
            _hookSelector.TabIndex = 0;
            _hookSelector.AccessibleName = "Keyboard hook review selector";
            _hookSelector.AccessibleDescription = "Use Up and Down Arrow to select each hook. Exact details follow this selector.";
            selectorRow.Controls.Add(selectorLabel, 0, 0);
            selectorRow.Controls.Add(_hookSelector, 1, 0);
            root.Controls.Add(selectorRow, 0, 3);

            _details.Dock = DockStyle.Fill;
            _details.Multiline = true;
            _details.ReadOnly = true;
            _details.ScrollBars = ScrollBars.Vertical;
            _details.BackColor = Color.White;
            _details.BorderStyle = BorderStyle.FixedSingle;
            _details.Text = "Select a hook to inspect its exact command, source, matcher, and current hash.";
            _details.AccessibleName = "Selected hook details";
            _details.AccessibleDescription = "Exact command, source, matcher, handler, status message, and current hash for the selected hook.";
            _details.TabIndex = 1;
            root.Controls.Add(_details, 0, 4);

            _status.Dock = DockStyle.Fill;
            _status.TextAlign = ContentAlignment.MiddleLeft;
            _status.ForeColor = Color.FromArgb(75, 85, 99);
            root.Controls.Add(_status, 0, 5);

            FlowLayoutPanel buttons = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.RightToLeft,
                WrapContents = false,
                Padding = new Padding(0, 7, 0, 0)
            };
            ConfigureButton(_close, "Close", 100);
            ConfigureButton(_refresh, "Refresh", 100);
            ConfigureButton(_trust, "Review and trust these 6 hooks", 238);
            _close.Text = "&Close";
            _refresh.Text = "&Refresh";
            _trust.Text = "Review and &trust these 6 hooks";
            _close.TabIndex = 4;
            _refresh.TabIndex = 3;
            _trust.TabIndex = 2;
            _trust.BackColor = Color.FromArgb(37, 99, 235);
            _trust.ForeColor = Color.White;
            _trust.FlatStyle = FlatStyle.Flat;
            _trust.FlatAppearance.BorderSize = 0;
            _trust.Enabled = false;
            buttons.Controls.Add(_close);
            buttons.Controls.Add(_refresh);
            buttons.Controls.Add(_trust);
            root.Controls.Add(buttons, 0, 6);
            _grid.NextTabControl = _details;
            _grid.PreviousTabControl = _close;
            _grid.KeyboardReviewControl = _hookSelector;

            Label footer = new Label
            {
                Text = "Only dev-rigor-stack hook hashes shown above can be trusted by this app.",
                Dock = DockStyle.Fill,
                ForeColor = Color.FromArgb(107, 114, 128),
                TextAlign = ContentAlignment.MiddleLeft
            };
            root.Controls.Add(footer, 0, 7);

            _grid.SelectionChanged += delegate { ShowSelectedDetails(); };
            _hookSelector.SelectedIndexChanged += delegate
            {
                int index = _hookSelector.SelectedIndex;
                if (index < 0 || index >= _grid.Rows.Count) return;
                _grid.ClearSelection();
                _grid.Rows[index].Selected = true;
                ShowSelectedDetails();
            };
            _close.Click += delegate { Close(); };
            _refresh.Click += delegate { LoadHooks(false); };
            _trust.Click += delegate { ConfirmAndTrust(); };
            Shown += delegate { if (_loadOnShown) LoadHooks(false); };
            FormClosing += delegate(object sender, FormClosingEventArgs args)
            {
                if (!_busy) return;
                args.Cancel = true;
                _status.Text = "Please wait for the current Codex verification to finish before closing.";
            };
        }

        private void ConfigureGrid()
        {
            _grid.Dock = DockStyle.Fill;
            _grid.ReadOnly = true;
            _grid.AllowUserToAddRows = false;
            _grid.AllowUserToDeleteRows = false;
            _grid.AllowUserToResizeRows = false;
            _grid.MultiSelect = false;
            _grid.StandardTab = true;
            _grid.TabStop = false;
            _grid.AccessibleName = "Six installed Dev Rigor hooks";
            _grid.AccessibleDescription = "Use Up and Down Arrow to select a hook. Tab moves to the selected hook details, review action, refresh, and close controls.";
            _grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
            _grid.AutoGenerateColumns = false;
            _grid.BackgroundColor = Color.White;
            _grid.BorderStyle = BorderStyle.FixedSingle;
            _grid.RowHeadersVisible = false;
            _grid.AutoSizeRowsMode = DataGridViewAutoSizeRowsMode.AllCells;
            _grid.ColumnHeadersHeight = 38;
            _grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Event", HeaderText = "When it runs", Width = 155 });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Purpose", HeaderText = "What it enforces", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Status", HeaderText = "Codex status", Width = 125 });
        }

        protected override bool ProcessCmdKey(ref Message message, Keys keyData)
        {
            if ((keyData & Keys.KeyCode) == Keys.Tab &&
                (keyData & (Keys.Control | Keys.Alt)) == Keys.None)
            {
                if (FocusNextReviewControl((keyData & Keys.Shift) != Keys.Shift)) return true;
            }
            return base.ProcessCmdKey(ref message, keyData);
        }

        private bool FocusNextReviewControl(bool forward)
        {
            Control target = null;
            if (forward)
            {
                if (_hookSelector.ContainsFocus || _grid.ContainsFocus) target = _details;
                else if (_details.ContainsFocus) target = _trust.Enabled ? (Control)_trust : _refresh;
                else if (_trust.ContainsFocus) target = _refresh;
                else if (_refresh.ContainsFocus) target = _close;
                else if (_close.ContainsFocus) target = _hookSelector;
            }
            else
            {
                if (_hookSelector.ContainsFocus || _grid.ContainsFocus) target = _close;
                else if (_details.ContainsFocus) target = _hookSelector;
                else if (_trust.ContainsFocus) target = _details;
                else if (_refresh.ContainsFocus) target = _trust.Enabled ? (Control)_trust : _details;
                else if (_close.ContainsFocus) target = _refresh;
            }
            return target != null && target.Focus();
        }

        private static void ConfigureButton(Button button, string text, int width)
        {
            button.Text = text;
            button.Width = width;
            button.Height = 36;
            button.Margin = new Padding(8, 0, 0, 0);
        }

        private void LoadHooks(bool afterTrust)
        {
            if (_busy) return;
            SetBusy(true, afterTrust ? "Verifying the saved trust hashes with Codex…" : "Reading installed hooks from Codex…");
            Task.Factory.StartNew(() =>
            {
                return _loadFromCodex();
            }).ContinueWith(task => BeginInvoke(new Action(() =>
            {
                SetBusy(false, String.Empty);
                if (task.IsFaulted)
                {
                    ShowFailure(Unwrap(task.Exception).Message);
                    return;
                }
                ApplyHookList(task.Result, afterTrust);
            })));
        }

        private void ConfirmAndTrust()
        {
            if (_busy || !IsExactOwnedSet(_ownedHooks)) return;
            string review = String.Join("\r\n\r\n", _ownedHooks.Select(h =>
                EventLabel(h.EventName) + "\r\n" + h.Command +
                "\r\nSource: " + h.SourcePath +
                "\r\nMatcher: " + (String.IsNullOrWhiteSpace(h.Matcher) ? "all matching events" : h.Matcher) +
                "\r\nEnabled: " + h.Enabled + " · Timeout: " + h.TimeoutSec + " seconds" +
                "\r\nHash: " + h.CurrentHash
            ).ToArray());
            if (!_reviewAndConfirm(this, review)) return;

            List<HookRecord> reviewed = _ownedHooks.ToList();
            SetBusy(true, "Saving the six reviewed hashes through Codex…");
            Task.Factory.StartNew(() =>
            {
                return _trustThroughCodex(reviewed);
            }).ContinueWith(task => BeginInvoke(new Action(() =>
            {
                SetBusy(false, String.Empty);
                if (task.IsFaulted)
                {
                    ShowFailure(Unwrap(task.Exception).Message);
                    return;
                }
                ApplyHookList(task.Result, true);
            })));
        }

        private static HookListResult LoadFromCodex()
        {
            using (CodexAppServerSession session = new CodexAppServerSession())
            {
                HookListResult listed = session.ListHooks(Environment.CurrentDirectory, 2);
                string runtimeFailure = OwnershipRules.RuntimeFailure(Environment.GetEnvironmentVariable("CODEX_HOME"));
                if (runtimeFailure.Length > 0) throw new InvalidOperationException(runtimeFailure);
                return listed;
            }
        }

        private static HookListResult TrustThroughCodex(List<HookRecord> reviewed)
        {
            using (CodexAppServerSession session = new CodexAppServerSession())
            {
                string runtimeFailure = OwnershipRules.RuntimeFailure(Environment.GetEnvironmentVariable("CODEX_HOME"));
                if (runtimeFailure.Length > 0) throw new InvalidOperationException(runtimeFailure);
                HookListResult fresh = session.ListHooks(Environment.CurrentDirectory, 2);
                List<HookRecord> freshOwned = FilterOwned(fresh.Hooks);
                if (!IsExactOwnedSet(freshOwned))
                    throw new InvalidOperationException("The installed hook set changed during review. Refresh and inspect it again.");
                foreach (HookRecord original in reviewed)
                {
                    HookRecord current = freshOwned.FirstOrDefault(h => h.Key == original.Key);
                    if (current == null || current.CurrentHash != original.CurrentHash)
                        throw new InvalidOperationException("A hook changed during review. Nothing was trusted; refresh and inspect it again.");
                }
                session.TrustHooks(freshOwned);
                return session.RefreshAndVerify(Environment.CurrentDirectory);
            }
        }

        private static bool ReviewAndConfirm(IWin32Window owner, string review)
        {
            using (HookReviewDialog dialog = new HookReviewDialog(review))
                return dialog.ShowDialog(owner) == DialogResult.OK;
        }

        private static void ReportFailure(IWin32Window owner, string message)
        {
            MessageBox.Show(
                owner,
                "Codex could not complete the hook check. No trust settings were changed.\r\n\r\nRestart Codex Desktop, then choose Refresh. If it still fails, copy the technical details shown in the main window for a bug report.",
                "Dev Rigor activation needs attention",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }

        internal void ApplyHookListForTest(HookListResult result)
        {
            ApplyHookList(result, false);
        }

        internal void PerformTrustClickForTest()
        {
            _trust.PerformClick();
        }

        internal string StatusForTest { get { return _status.Text; } }
        internal bool TrustEnabledForTest { get { return _trust.Enabled; } }

        private void ApplyHookList(HookListResult result, bool afterTrust)
        {
            _ownedHooks = FilterOwned(result.Hooks);
            PopulateGrid(_ownedHooks);
            if (result.Errors.Count > 0)
            {
                ShowFailure("Codex reported hook errors:\r\n" + String.Join("\r\n", result.Errors.ToArray()));
                return;
            }
            if (!IsExactOwnedSet(_ownedHooks))
            {
                _summary.Text = "The complete six-hook Dev Rigor set is not installed in this Codex profile.\r\nAsk Codex Desktop to install dev-rigor-stack 1.7.0, then reopen this app.";
                _status.Text = "Found " + _ownedHooks.Count + " of 6 owned hooks. No trust settings were changed.";
                _status.ForeColor = Color.FromArgb(185, 28, 28);
                _trust.Enabled = false;
                return;
            }

            int trusted = _ownedHooks.Count(h => String.Equals(h.TrustStatus, "trusted", StringComparison.OrdinalIgnoreCase));
            if (trusted == ExpectedHookCount)
            {
                _summary.Text = "Verified: all six Dev Rigor hooks are trusted by Codex.\r\nRestart Codex Desktop so every new task starts with the safeguards active.";
                _status.Text = afterTrust ? "Activation verified after the trust write." : "Activation is already verified.";
                _status.ForeColor = Color.FromArgb(21, 128, 61);
                _trust.Text = "Verified — all 6 hooks trusted";
                _trust.BackColor = Color.FromArgb(229, 231, 235);
                _trust.ForeColor = Color.FromArgb(55, 65, 81);
                _trust.Enabled = false;
            }
            else
            {
                _summary.Text = "Review every row below. In Keyboard review, use Up and Down Arrow to select each hook; press Alt+T to review trust.\r\nTab moves through details and actions. The app asks once more before trust. No terminal is required.";
                _status.Text = trusted + " of 6 trusted. " + (ExpectedHookCount - trusted) + " require review.";
                _status.ForeColor = Color.FromArgb(146, 64, 14);
                _trust.Text = "Review and &trust these 6 hooks";
                _trust.BackColor = Color.FromArgb(37, 99, 235);
                _trust.ForeColor = Color.White;
                _trust.Enabled = true;
            }
            if (result.Warnings.Count > 0)
                _status.Text += " Codex warning: " + String.Join("; ", result.Warnings.ToArray());
        }

        private void PopulateGrid(List<HookRecord> hooks)
        {
            _grid.Rows.Clear();
            _hookSelector.Items.Clear();
            _grid.AccessibleName = "Six installed Dev Rigor hooks. " + String.Join(" ", hooks
                .OrderBy(h => Array.IndexOf(ExpectedEvents, h.EventName))
                .Select(h => EventLabel(h.EventName) + ": " + Purpose(h.EventName) + " Codex status: " + StatusLabel(h.TrustStatus) + ".")
                .ToArray());
            foreach (HookRecord hook in hooks.OrderBy(h => Array.IndexOf(ExpectedEvents, h.EventName)))
            {
                int rowIndex = _grid.Rows.Add(EventLabel(hook.EventName), Purpose(hook.EventName), StatusLabel(hook.TrustStatus));
                DataGridViewRow row = _grid.Rows[rowIndex];
                row.Tag = hook;
                row.AccessibilityObject.Name = EventLabel(hook.EventName) + ". " + Purpose(hook.EventName) + " Codex status: " + StatusLabel(hook.TrustStatus) + ".";
                row.Cells[0].AccessibilityObject.Name = "When it runs: " + EventLabel(hook.EventName);
                row.Cells[1].AccessibilityObject.Name = "What it enforces: " + Purpose(hook.EventName);
                row.Cells[2].AccessibilityObject.Name = "Codex status: " + StatusLabel(hook.TrustStatus);
                row.Cells[2].Style.ForeColor = String.Equals(hook.TrustStatus, "trusted", StringComparison.OrdinalIgnoreCase)
                    ? Color.FromArgb(21, 128, 61)
                    : Color.FromArgb(180, 83, 9);
                _hookSelector.Items.Add(EventLabel(hook.EventName) + " — " + StatusLabel(hook.TrustStatus));
            }
            if (_grid.Rows.Count > 0)
            {
                _grid.Rows[0].Selected = true;
                _hookSelector.SelectedIndex = 0;
                _grid.CurrentCell = null;
                BeginInvoke(new Action(() =>
                {
                    ActiveControl = _hookSelector;
                    _hookSelector.Focus();
                }));
                ShowSelectedDetails();
            }
        }

        private void ShowSelectedDetails()
        {
            if (_grid.SelectedRows.Count == 0) return;
            HookRecord hook = _grid.SelectedRows[0].Tag as HookRecord;
            if (hook == null) return;
            _details.Text = "Command: " + hook.Command + "\r\n" +
                            "Source: " + hook.SourcePath + "\r\n" +
                            "Matcher: " + (String.IsNullOrWhiteSpace(hook.Matcher) ? "all matching events" : hook.Matcher) + "\r\n" +
                            "Handler: " + hook.HandlerType + " · Enabled: " + hook.Enabled + " · Timeout: " + hook.TimeoutSec + " seconds\r\n" +
                            "Status message: " + (String.IsNullOrWhiteSpace(hook.StatusMessage) ? "none" : hook.StatusMessage) + "\r\n" +
                            "Current hash: " + hook.CurrentHash;
            _details.AccessibleName = "Selected hook details. " + _details.Text.Replace("\r\n", ". ");
        }

        private void SetBusy(bool busy, string message)
        {
            _busy = busy;
            UseWaitCursor = busy;
            _refresh.Enabled = !busy;
            _close.Enabled = !busy;
            _trust.Enabled = !busy && IsExactOwnedSet(_ownedHooks) && _ownedHooks.Any(h => !String.Equals(h.TrustStatus, "trusted", StringComparison.OrdinalIgnoreCase));
            _status.Text = message;
            _status.ForeColor = Color.FromArgb(75, 85, 99);
        }

        private void ShowFailure(string message)
        {
            _summary.Text = "Codex Desktop hook activation could not be verified.";
            _status.Text = "No trust settings were changed. Restart Codex Desktop, then choose Refresh.";
            _status.ForeColor = Color.FromArgb(185, 28, 28);
            _details.Text = "Technical details for a bug report:\r\n" + message;
            _trust.Enabled = false;
            _reportFailure(this, message);
        }

        private static List<HookRecord> FilterOwned(IEnumerable<HookRecord> hooks)
        {
            string codexHome = Environment.GetEnvironmentVariable("CODEX_HOME");
            return OwnershipRules.FilterOwned(hooks, codexHome);
        }

        private static bool IsExactOwnedSet(List<HookRecord> hooks)
        {
            return OwnershipRules.IsExactOwnedSet(hooks);
        }

        private static string EventLabel(string eventName)
        {
            switch (eventName)
            {
                case "sessionStart": return "Task starts / resumes";
                case "subagentStart": return "Subagent starts";
                case "userPromptSubmit": return "You send a prompt";
                case "postToolUse": return "A change or UI action runs";
                case "stop": return "Codex tries to stop";
                case "subagentStop": return "A subagent tries to stop";
                default: return eventName;
            }
        }

        private static string Purpose(string eventName)
        {
            switch (eventName)
            {
                case "sessionStart": return "Loads the rigor rules at the beginning and after continuity events.";
                case "subagentStart": return "Gives delegated work the same rigor rules.";
                case "userPromptSubmit": return "Routes coding and release requests through the required gates.";
                case "postToolUse": return "Records grounded evidence after changes and interactive checks.";
                case "stop": return "Refuses an unsupported done claim when required evidence is missing.";
                case "subagentStop": return "Applies the same evidence check to delegated work.";
                default: return "Dev Rigor enforcement";
            }
        }

        private static string StatusLabel(string status)
        {
            if (String.Equals(status, "trusted", StringComparison.OrdinalIgnoreCase)) return "Trusted";
            if (String.Equals(status, "modified", StringComparison.OrdinalIgnoreCase)) return "Changed — review";
            return "Needs review";
        }

        private static Exception Unwrap(AggregateException exception)
        {
            Exception current = exception.Flatten().InnerExceptions.FirstOrDefault();
            return current ?? exception;
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ActivatorForm());
        }
    }
}
