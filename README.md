# Code RAG Review (TypeScript)

Локальный RAG для индексации кодовой базы (любой язык как текст) и code review через локальную модель.

## Что умеет

- Индексирует репозиторий в локальную LanceDB (`.coderag/`).
- Чанкает код по AST для JS/TS (TypeScript Compiler API), для остальных языков — fallback на текстовые чанки.
- Переиспользует эмбеддинги неизмененных чанков между переиндексациями.
- Достает релевантный контекст по diff/запросу через ANN-поиск LanceDB.
- Делает code review на локальной LLM через Ollama.

## Требования

- Node.js 20+
- [Ollama](https://ollama.com/)
- Локальные модели:
  - эмбеддинги: `nomic-embed-text-v2-moe:latest`
  - ревью: например `qwen3:8b`

Пример установки моделей:

```bash
ollama pull nomic-embed-text-v2-moe:latest
ollama pull qwen3:8b
```

## Установка

```bash
npm install
npm run build
```

## Быстрый старт

1. Построить индекс:

```bash
npm run index -- --repo . --embedding-model nomic-embed-text-v2-moe:latest
```

2. Сделать ревью текущего `git diff`:

```bash
npm run review -- --repo . --review-model qwen3:8b --show-sources
```

3. Проверить retrieval вручную:

```bash
npm run search -- --query "auth middleware race condition"
```

## Полезные параметры

- `index`:
  - `--chunking ast|text` (по умолчанию `ast`)
  - `--chunk-size 1400`
  - `--overlap-lines 20`
  - `--max-file-size-kb 300`
  - `--exclude dir1,dir2`
- `review`:
  - `--diff-file /path/to/diff.patch`
  - `--top-k 8`
  - `--max-diff-chars 18000`
  - `--embedding-model` (если нужно переопределить модель retrieval)
- Общее:
  - `--ollama-url http://127.0.0.1:11434`

## Переменные окружения

- `CODE_RAG_EMBED_MODEL` (по умолчанию `nomic-embed-text-v2-moe`)
- `CODE_RAG_REVIEW_MODEL` (по умолчанию `qwen3:8b`)
- `OLLAMA_BASE_URL` (по умолчанию `http://127.0.0.1:11434`)

## Как это работает

1. Сканирование текстовых файлов в репозитории (бинарники и большие файлы пропускаются).
2. Чанкинг:
   - `ast` для JS/TS файлов (function/class/method и другие declaration-узлы),
   - `text` fallback для неподдерживаемых языков.
3. Эмбеддинги каждого чанка через Ollama.
4. Чанки и эмбеддинги сохраняются в LanceDB таблицу `code_chunks` + `manifest.json`.
5. По запросу/диффу строится embedding и выбираются top-K чанков через `vectorSearch`.
6. В prompt ревью-модели передаются:
   - задача ревью
   - diff
   - релевантный контекст из индекса

## Ограничения

- На очень больших монорепах может потребоваться тюнинг индекса LanceDB под ваш профиль запросов.
- Качество зависит от embedding/review моделей.
- Для языков вне JS/TS используется fallback на текстовые чанки.
