"""
Execute le code etudiant contre les cas de test et renvoie un JSON sur stdout.
Entree (stdin) : { "code": "...", "function": "nom", "cases": [ {"args":[...], "expected": ...}, ... ] }
Sortie (stdout): { "available": true, "function": "...", "passed": n, "total": m,
                   "results": [ {"args":[...], "expected":..., "got":..., "passed":bool, "error":str|null} ] }
Aucune dependance externe : repose sur la stdlib uniquement.
"""
import sys
import io
import json
import contextlib


def main():
    raw = sys.stdin.read()
    payload = json.loads(raw)
    code = payload["code"]
    func_name = payload["function"]
    cases = payload.get("cases", [])

    results = []
    namespace = {}

    # 1) Compiler / executer la definition de l'etudiant
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            exec(code, namespace)
    except Exception as exc:  # erreur de syntaxe / exec
        print(json.dumps({
            "available": True,
            "function": func_name,
            "passed": 0,
            "total": len(cases),
            "load_error": "{}: {}".format(type(exc).__name__, exc),
            "results": [],
        }))
        return

    func = namespace.get(func_name)
    if not callable(func):
        print(json.dumps({
            "available": True,
            "function": func_name,
            "passed": 0,
            "total": len(cases),
            "load_error": "La fonction '{}' n'a pas ete definie.".format(func_name),
            "results": [],
        }))
        return

    # 2) Lancer chaque cas
    passed = 0
    for case in cases:
        args = case.get("args", [])
        expected = case.get("expected")
        entry = {"args": args, "expected": expected, "got": None,
                 "passed": False, "error": None, "stdout": ""}
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                got = func(*args)
            entry["got"] = got
            entry["stdout"] = buf.getvalue()[:500]
            entry["passed"] = (got == expected)
            if entry["passed"]:
                passed += 1
        except Exception as exc:
            entry["error"] = "{}: {}".format(type(exc).__name__, exc)
            entry["stdout"] = buf.getvalue()[:500]
        results.append(entry)

    print(json.dumps({
        "available": True,
        "function": func_name,
        "passed": passed,
        "total": len(cases),
        "load_error": None,
        "results": results,
    }))


if __name__ == "__main__":
    main()
