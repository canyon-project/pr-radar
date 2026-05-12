1. 不止是落库就可以了
2. 需要以github token所有者的名义，fork对应的仓库，仓库名规范为`${org}-${repo}-${随机}`，如果fork过了就跳过
3. 然后每次有新的pr的时候，基于这个fork的仓库然后通过api创建一个新分支，分支命名规则是 `canyon-bot/pr-${prNumber}`，基于的是这次pr的commit的那个版本
4. 并且在此基础上再commit push添加一个test.md的测试文件
