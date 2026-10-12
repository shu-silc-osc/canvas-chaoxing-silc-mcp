# GPG 签名

签名者：GitHub 公开账号 `Bowen-Xue-ac2`。

- 公钥：[`keys/Bowen-Xue-ac2.asc`](keys/Bowen-Xue-ac2.asc)，ASCII-armored OpenPGP **PUBLIC KEY**。
- 完整指纹：`DE32 71F7 3FF2 6710 F134 7660 A2A2 9757 2CD4 B909`。
- Key ID：`A2A297572CD4B909`。
- 本次及后续本仓库提交使用该账号的 GitHub noreply 邮箱；公开公钥只包含 noreply 身份，不包含本地密钥中的私人邮箱。
- 初始提交采用 Conventional Commits：`feat: publish local read-only student center`。
- 版本标签：`v0.1.0-experiment`，签名附注标签。

公钥用于验证签名；私钥与口令不进入仓库。公钥已经登记到签名者的 GitHub 账号。导入前请独立核对完整指纹：

```sh
gpg --show-keys --fingerprint docs/keys/Bowen-Xue-ac2.asc
gpg --import docs/keys/Bowen-Xue-ac2.asc
git verify-commit HEAD
git verify-tag v0.1.0-experiment
```

验证时的信任提示不等同于签名无效，仍应核对指纹。不要导入来源不明的私钥或把私钥提交到 Git。

历史提交和旧标签保留其原始签名与身份；更换新提交的邮箱不改写已发布历史。
