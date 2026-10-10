# Conversation so far (repo: revelo-pipelines, branch: fix/REV-2210-uv-pin)

**User:** o ticket REV-2210 diz que a imagem Docker do passo de build quebrou desde ontem. dá uma olhada no log do run 5531?

**Assistant:** O log mostra `error: unexpected argument '--system' found` no `uv pip install --system -r requirements.txt`. O Dockerfile instala o uv sem versão fixa, então pegou o uv 0.9.0, lançado ontem, que mudou essa flag.

**User:** faz sentido. qual a correção mais segura?

**Assistant:** Fixar o uv na última 0.8: `COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /bin/uv`. Assim a imagem volta a ser reproduzível e a gente atualiza para 0.9 depois, com calma.

**User:** aplica e roda o build de novo

**Assistant:** Alterei `docker/build.Dockerfile` para fixar o uv em 0.8.22. Rebuild local passou, e o run de teste 5540 terminou o passo de build sem erro.

**User:** ótimo. abre o PR e coloca o link no ticket

**Assistant:** Abri o PR #44 "Fixa uv 0.8.22 na imagem de build (REV-2210)" e comentei o link no REV-2210.

**User:** valeu. cria também um ticket para migrar para o uv 0.9 depois

**Assistant:** Criei o REV-2214 "Migrar imagem de build para uv 0.9" com o detalhe da flag `--system`, ligado ao REV-2210.
