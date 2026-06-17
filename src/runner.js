// Execute le code etudiant (Python) contre les cas de test via src/harness.py.
// Degradation gracieuse : si python3 est absent, renvoie { available: false }.
const { spawn } = require('child_process');
const path = require('path');

const HARNESS = path.join(__dirname, 'harness.py');
const PYTHON = process.env.PYTHON_BIN || 'python3';
const TIMEOUT_MS = 8000;

function runTests(code, tests) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(PYTHON, [HARNESS], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ available: false, reason: 'python3 introuvable: ' + err.message });
    }

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); }, TIMEOUT_MS);

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ available: false, reason: 'python3 introuvable: ' + err.message });
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (codeExit) => {
      clearTimeout(timer);
      if (codeExit === null) {
        return resolve({ available: true, timeout: true, passed: 0,
          total: (tests.cases || []).length, results: [],
          load_error: 'Timeout: execution trop longue (boucle infinie ?).' });
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        resolve({ available: true, passed: 0, total: (tests.cases || []).length,
          results: [], load_error: 'Sortie illisible. stderr: ' + stderr.slice(0, 300) });
      }
    });

    proc.stdin.write(JSON.stringify({
      code,
      function: tests.function,
      cases: tests.cases || [],
    }));
    proc.stdin.end();
  });
}

module.exports = { runTests };
