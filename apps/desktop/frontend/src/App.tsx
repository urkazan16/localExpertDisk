import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getAppInfo, type AppInfo, type Platform } from "./api/generated";

import { errorMessage } from "./api/errors";
import { ScanPanel } from "./ScanPanel";

type State =
  | { status: "loading" }
  | { status: "browser" }
  | { status: "ready"; info: AppInfo }
  | { status: "error"; message: string; retryable: boolean };
const platforms: Record<Platform, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  unsupported: "Не поддерживается",
};

export function App() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let active = true;
    if (!isTauri()) {
      setState({ status: "browser" });
      return;
    }
    setState({ status: "loading" });
    getAppInfo().then(
      (info) => {
        if (active) setState({ status: "ready", info });
      },
      (error: unknown) => {
        if (active)
          setState({
            status: "error",
            message: errorMessage(error),
            retryable: !(
              typeof error === "object" &&
              error !== null &&
              "recoverable" in error &&
              error.recoverable === false
            ),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <div className="shell">
      <header>
        <span className="mark" aria-hidden="true">
          ◉
        </span>
        <span>Local Expert Disk</span>
        <span className="badge">Ранняя сборка</span>
      </header>
      <main>
        <p className="eyebrow">АНАЛИЗ ДИСКОВОГО ПРОСТРАНСТВА</p>
        <h1>
          Каждому файлу —<br />
          своё место.
        </h1>
        <p className="intro">
          Локальный инструмент для изучения занятого места на диске. Ваши файлы
          остаются на вашем компьютере.
        </p>
        <section className="panel" aria-labelledby="status-title">
          <div className="panel-heading">
            <h2 id="status-title">Состояние приложения</h2>
            <span className="stage">Локальное подключение</span>
          </div>
          <div aria-live="polite">
            {state.status === "loading" && (
              <p role="status">Проверяем локальную базу и подключение…</p>
            )}
            {state.status === "browser" && (
              <div>
                <p className="notice">Открыт браузерный предпросмотр</p>
                <p>
                  Подключение к диску доступно только в настольном приложении.
                  Здесь можно просмотреть интерфейс.
                </p>
              </div>
            )}
            {state.status === "error" && (
              <div role="alert">
                <p>{state.message}</p>
                {state.retryable && (
                  <button onClick={() => setAttempt((value) => value + 1)}>
                    Повторить проверку
                  </button>
                )}
              </div>
            )}
            {state.status === "ready" && (
              <>
                <p className="notice success">
                  Приложение подключено · локальная база готова
                </p>
                <dl>
                  <div>
                    <dt>Платформа</dt>
                    <dd>{platforms[state.info.platform]}</dd>
                  </div>
                  <div>
                    <dt>Версия приложения</dt>
                    <dd>{state.info.version}</dd>
                  </div>
                  <div>
                    <dt>Версия схемы базы</dt>
                    <dd>{state.info.schema_version}</dd>
                  </div>
                </dl>
              </>
            )}
          </div>
        </section>
        <ScanPanel enabled={state.status === "ready"} />
      </main>
      <footer>
        macOS · Windows · Linux <span>Локально. Без облачного хранилища.</span>
      </footer>
    </div>
  );
}
