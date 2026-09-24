import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getAppInfo, type AppInfo, type Platform } from "./api/generated";

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
const errors: Record<string, string> = {
  "errors.storage_unavailable":
    "Не удалось открыть локальную базу. Проверьте доступ к папке приложения и перезапустите его.",
  "errors.unsupported_schema":
    "База создана более новой версией приложения. Обновите приложение, чтобы сохранить совместимость.",
  "errors.invalid_schema":
    "История миграций базы повреждена. Для продолжения потребуется восстановление базы.",
  "errors.internal":
    "Не удалось проверить состояние приложения. Перезапустите его.",
};
function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "user_message_key" in error &&
    typeof error.user_message_key === "string"
  ) {
    return (
      errors[error.user_message_key] ??
      "Не удалось связаться с приложением. Повторите проверку."
    );
  }
  return "Не удалось связаться с приложением. Повторите проверку.";
}

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
            <span className="stage">Этап 0 · Foundation</span>
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
        <section className="next" aria-labelledby="next-title">
          <span className="number">01</span>
          <div>
            <h2 id="next-title">Следующий этап — сканирование</h2>
            <p>
              Выбор диска, обход каталогов, подсчёт размеров и отмена
              сканирования появятся на следующем этапе. В этой сборке анализ
              файлов ещё недоступен.
            </p>
          </div>
        </section>
      </main>
      <footer>
        macOS · Windows · Linux <span>Локально. Без облачного хранилища.</span>
      </footer>
    </div>
  );
}
