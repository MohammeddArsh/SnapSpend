# Contributing to SnapSpend

Thank you for your interest in contributing to SnapSpend! We welcome contributions from developers of all skill levels.

---

## 📜 Code of Conduct

* Be respectful, welcoming, and collaborative.
* Focus on constructive code reviews and feedback.

---

## 🛠️ How to Contribute

### 1. Report Issues
If you encounter a bug or have a feature suggestion, please check existing issues before submitting a new report. Include details on how to reproduce bugs.

### 2. Local Setup
1. Fork the repository on GitHub.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/your-username/SnapSpend.git
   cd SnapSpend
   ```
3. Install frontend dependencies:
   ```bash
   npm install
   ```
4. Create a working branch:
   ```bash
   git checkout -b feature/my-new-feature
   ```

### 3. Guidelines & Quality Control
* **Vanilla ES Modules**: Maintain zero unnecessary frontend dependencies. Keep core logic modular in `js/`.
* **Testing**: Run unit tests before submitting:
  ```bash
  npm test
  ```
* **Linting & Formatting**: Ensure code passes type checks:
  ```bash
  npm run lint
  ```
* **Security**: Do not commit API keys, `.env` files, or secrets.

### 4. Pull Requests
1. Push your branch to GitHub.
2. Open a Pull Request against the `main` branch.
3. Provide a concise summary of your changes and any relevant test results.
