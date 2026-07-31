#!/usr/bin/env python3
"""RAG Knowledge Base 一鍵建置（#9／#34，決賽新環境用）。

## 為什麼需要這支

`infra/template.yaml` 只**引用** `KnowledgeBaseId`，不會建立 Bedrock Knowledge Base、
S3 Vectors、語料 bucket——這三樣都是 CloudFormation 管不到的外部資源。所以：

  **部署會「成功」，但 RAG 靜默失效。** 畫面不會壞、回答還算像樣，只是「附出處」
  這個賣點安靜消失，TEST_CHECKLIST 的 F3 失敗。

實際踩過兩次：
- 07/29（#34）線上 KB `DSIYBVI1IX` 不存在——它其實在**另一個隊員的帳號** 022289351970
- 07/31 隊長帳號 525237381533 砍掉重建後，同樣沒有 KB

KB ID 是「帳號＋region」範圍的資源。**換帳號＝一定要重建**，8/1 官方新環境必然重演。

## 用法

    # 只檢查現況，不改任何東西（先跑這個）
    python3 scripts/setup_rag_kb.py --check

    # 建立所有資源；語料檔從 Drive 下載到 repo 外的暫存目錄再指過來
    python3 scripts/setup_rag_kb.py --corpus ~/Downloads/chunks.jsonl

    # 資源已建好，只是要重新灌語料
    python3 scripts/setup_rag_kb.py --corpus ~/Downloads/chunks.jsonl --reingest

跑完會印出新的 KB ID 與接下來要執行的 `sam deploy` 指令。

## 鐵則

- 語料**絕不進 git**（鐵則 1）。本腳本只接受 repo 以外的路徑，並在偵測到 repo 內路徑時拒絕。
- 本腳本不需要也不讀取任何 MAX 金鑰。
- 所有建立動作都是冪等的：資源已存在就沿用，不會建出第二套。
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

REGION_DEFAULT = "us-east-1"
CORPUS_PREFIX = "corpus/"
KB_NAME = "maimate-rag-kb"
DS_NAME = "maimate-rag-s3"
VECTOR_BUCKET = "maimate-rag-vectors"
VECTOR_INDEX = "maimate-kb-index"
ROLE_NAME = "MaiMateRagKbRole"
# Titan Text Embeddings V2：1024 維、FLOAT32，與向量索引必須一致（不一致 ingestion 會失敗）
EMBED_MODEL = "amazon.titan-embed-text-v2:0"
EMBED_DIM = 1024
REPO_ROOT = Path(__file__).resolve().parent.parent


def aws(*args, region=None, check=True, quiet=False):
    """跑一次 aws CLI，回傳解析後的 JSON（沒有輸出就回 None）。"""
    cmd = ["aws", *args]
    if region:
        cmd += ["--region", region]
    if "--output" not in args:
        cmd += ["--output", "json"]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        if check:
            raise RuntimeError(f"aws {' '.join(args[:3])} 失敗：{p.stderr.strip()[:400]}")
        if not quiet:
            pass
        return None
    return json.loads(p.stdout) if p.stdout.strip() else None


def step(msg):
    print(f"\n── {msg}")


def ok(msg):
    print(f"  ✔ {msg}")


def info(msg):
    print(f"    {msg}")


def ensure_corpus_bucket(account, region):
    name = f"maimate-rag-corpus-{account}"
    exists = aws("s3api", "head-bucket", "--bucket", name, check=False, quiet=True) is not None or \
        subprocess.run(["aws", "s3api", "head-bucket", "--bucket", name],
                       capture_output=True).returncode == 0
    if not exists:
        args = ["s3api", "create-bucket", "--bucket", name]
        if region != "us-east-1":   # us-east-1 不接受 LocationConstraint
            args += ["--create-bucket-configuration", f"LocationConstraint={region}"]
        aws(*args, region=region)
        ok(f"建立語料 bucket {name}")
    else:
        ok(f"語料 bucket already exists：{name}")
    aws("s3api", "put-public-access-block", "--bucket", name,
        "--public-access-block-configuration",
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
        region=region)
    info("公開存取已全部封鎖")
    return name


def ensure_vector_index(region):
    buckets = (aws("s3vectors", "list-vector-buckets", region=region) or {}).get("vectorBuckets", [])
    if not any(b["vectorBucketName"] == VECTOR_BUCKET for b in buckets):
        aws("s3vectors", "create-vector-bucket", "--vector-bucket-name", VECTOR_BUCKET, region=region)
        ok(f"建立向量 bucket {VECTOR_BUCKET}")
    else:
        ok(f"向量 bucket already exists：{VECTOR_BUCKET}")

    idx = (aws("s3vectors", "list-indexes", "--vector-bucket-name", VECTOR_BUCKET,
               region=region) or {}).get("indexes", [])
    hit = next((i for i in idx if i["indexName"] == VECTOR_INDEX), None)
    if not hit:
        aws("s3vectors", "create-index", "--vector-bucket-name", VECTOR_BUCKET,
            "--index-name", VECTOR_INDEX, "--data-type", "float32",
            "--dimension", str(EMBED_DIM), "--distance-metric", "cosine", region=region)
        idx = (aws("s3vectors", "list-indexes", "--vector-bucket-name", VECTOR_BUCKET,
                   region=region) or {}).get("indexes", [])
        hit = next(i for i in idx if i["indexName"] == VECTOR_INDEX)
        ok(f"建立向量索引 {VECTOR_INDEX}（{EMBED_DIM} 維 / FLOAT32 / cosine）")
    else:
        ok(f"向量索引 already exists：{VECTOR_INDEX}")
    return hit["indexArn"]


def ensure_role(account, region, corpus_bucket, index_arn):
    trust = {"Version": "2012-10-17", "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "bedrock.amazonaws.com"},
        "Action": "sts:AssumeRole",
        # 限定只能被本帳號的 KB 用，避免被別的帳號拿去當跳板（confused deputy）
        "Condition": {"StringEquals": {"aws:SourceAccount": account}},
    }]}
    policy = {"Version": "2012-10-17", "Statement": [
        {"Effect": "Allow", "Action": ["bedrock:InvokeModel"],
         "Resource": f"arn:aws:bedrock:{region}::foundation-model/{EMBED_MODEL}"},
        {"Effect": "Allow", "Action": ["s3:GetObject", "s3:ListBucket"],
         "Resource": [f"arn:aws:s3:::{corpus_bucket}", f"arn:aws:s3:::{corpus_bucket}/*"]},
        # 索引與 vector bucket 兩層都要給。只給索引 ARN 會在 create-knowledge-base 當下
        # 被拒（Bedrock 會先 assume role 去驗證儲存設定），錯誤訊息是
        # 「storage configuration provided is invalid」，很容易誤判成設定寫錯。
        {"Effect": "Allow",
         "Action": ["s3vectors:PutVectors", "s3vectors:GetVectors", "s3vectors:QueryVectors",
                    "s3vectors:DeleteVectors", "s3vectors:GetIndex", "s3vectors:ListVectors",
                    "s3vectors:GetVectorBucket", "s3vectors:ListIndexes"],
         "Resource": [index_arn, index_arn.split("/index/")[0]]},
    ]}
    existing = aws("iam", "get-role", "--role-name", ROLE_NAME, check=False)
    if not existing:
        existing = aws("iam", "create-role", "--role-name", ROLE_NAME,
                       "--assume-role-policy-document", json.dumps(trust),
                       "--description", "MaiMate RAG Knowledge Base execution role")
        ok(f"建立 IAM role {ROLE_NAME}")
        time.sleep(10)   # IAM 是最終一致性，剛建好立刻給 Bedrock 用會被判無效
    else:
        ok(f"IAM role already exists：{ROLE_NAME}")
    aws("iam", "put-role-policy", "--role-name", ROLE_NAME,
        "--policy-name", "MaiMateRagKbPolicy", "--policy-document", json.dumps(policy))
    info("權限：只能讀語料 bucket、寫這個向量索引、呼叫 embedding 模型")
    return existing["Role"]["Arn"]


def find_kb(region):
    for kb in (aws("bedrock-agent", "list-knowledge-bases", region=region) or {}).get(
            "knowledgeBaseSummaries", []):
        if kb["name"] == KB_NAME:
            return kb["knowledgeBaseId"]
    return None


def ensure_kb(region, role_arn, index_arn):
    kb_id = find_kb(region)
    if kb_id:
        ok(f"Knowledge Base already exists：{kb_id}")
        return kb_id
    # IAM 是最終一致性：policy 剛 put 完，Bedrock assume role 後可能還讀到舊的（沒有權限）。
    # 症狀是 ValidationException「storage configuration provided is invalid」夾帶
    # not authorized to perform: s3vectors:*——看起來像設定錯，其實只是還沒傳播。
    for attempt in range(6):
        try:
            return _create_kb(region, role_arn, index_arn)
        except RuntimeError as e:
            if "not authorized" not in str(e) or attempt == 5:
                raise
            info(f"IAM 尚未傳播，10 秒後重試（{attempt + 1}/5）")
            time.sleep(10)


def _create_kb(region, role_arn, index_arn):
    resp = aws("bedrock-agent", "create-knowledge-base", "--name", KB_NAME,
               "--role-arn", role_arn,
               "--knowledge-base-configuration", json.dumps({
                   "type": "VECTOR",
                   "vectorKnowledgeBaseConfiguration": {
                       "embeddingModelArn":
                           f"arn:aws:bedrock:{region}::foundation-model/{EMBED_MODEL}",
                       "embeddingModelConfiguration": {"bedrockEmbeddingModelConfiguration": {
                           "dimensions": EMBED_DIM, "embeddingDataType": "FLOAT32"}},
                   }}),
               "--storage-configuration", json.dumps({
                   "type": "S3_VECTORS",
                   "s3VectorsConfiguration": {"indexArn": index_arn}}),
               region=region)
    kb_id = resp["knowledgeBase"]["knowledgeBaseId"]
    ok(f"建立 Knowledge Base {kb_id}")
    return kb_id


def ensure_data_source(region, kb_id, corpus_bucket, account):
    for ds in (aws("bedrock-agent", "list-data-sources", "--knowledge-base-id", kb_id,
                   region=region) or {}).get("dataSourceSummaries", []):
        if ds["name"] == DS_NAME:
            ok(f"Data source already exists：{ds['dataSourceId']}")
            return ds["dataSourceId"]
    resp = aws("bedrock-agent", "create-data-source", "--knowledge-base-id", kb_id,
               "--name", DS_NAME,
               "--data-source-configuration", json.dumps({
                   "type": "S3",
                   "s3Configuration": {
                       "bucketArn": f"arn:aws:s3:::{corpus_bucket}",
                       "bucketOwnerAccountId": account,
                       "inclusionPrefixes": [CORPUS_PREFIX]}}),
               "--vector-ingestion-configuration", json.dumps({
                   "chunkingConfiguration": {
                       "chunkingStrategy": "FIXED_SIZE",
                       "fixedSizeChunkingConfiguration": {
                           "maxTokens": 300, "overlapPercentage": 10}}}),
               region=region)
    ds_id = resp["dataSource"]["dataSourceId"]
    ok(f"建立 data source {ds_id}（prefix {CORPUS_PREFIX}，fixed 300 tokens / 10% overlap）")
    return ds_id


def upload_corpus(path, bucket, region):
    """接受單一檔案或整個資料夾。Bedrock KB 的 S3 data source 吃 .md/.txt/.pdf/.html/.csv/.docx；
    一個主題一個檔比較好，檢索回來的 s3 URI 就是可讀的出處。"""
    p = Path(path).expanduser().resolve()
    if not p.exists():
        sys.exit(f"✘ 找不到語料：{p}")
    if REPO_ROOT == p or REPO_ROOT in p.parents:
        sys.exit(f"✘ 語料放在 repo 內（{p}）——鐵則 1 禁止語料進 git。\n"
                 f"  請放到 repo 以外的暫存目錄再指過來，上傳完即刪除本機副本。")
    if p.is_dir():
        subprocess.run(["aws", "s3", "sync", str(p), f"s3://{bucket}/{CORPUS_PREFIX}",
                        "--region", region, "--delete"], check=True, capture_output=True)
        files = sorted(f for f in p.rglob("*") if f.is_file())
        ok(f"語料資料夾已同步 s3://{bucket}/{CORPUS_PREFIX}（{len(files)} 個檔）")
        for f in files:
            info(f"· {f.name}（{f.stat().st_size:,} bytes）")
    else:
        subprocess.run(["aws", "s3", "cp", str(p), f"s3://{bucket}/{CORPUS_PREFIX}{p.name}",
                        "--region", region], check=True, capture_output=True)
        ok(f"語料已上傳 s3://{bucket}/{CORPUS_PREFIX}{p.name}（{p.stat().st_size:,} bytes）")
    info("上傳完成後請刪除本機暫存副本")


def ingest(region, kb_id, ds_id):
    job = aws("bedrock-agent", "start-ingestion-job", "--knowledge-base-id", kb_id,
              "--data-source-id", ds_id, region=region)["ingestionJob"]
    jid = job["ingestionJobId"]
    info(f"ingestion job {jid} 已啟動，等待完成…")
    for _ in range(120):
        time.sleep(5)
        j = aws("bedrock-agent", "get-ingestion-job", "--knowledge-base-id", kb_id,
                "--data-source-id", ds_id, "--ingestion-job-id", jid, region=region)["ingestionJob"]
        if j["status"] in ("COMPLETE", "FAILED"):
            s = j.get("statistics", {})
            info(f"status={j['status']} scanned={s.get('numberOfDocumentsScanned')} "
                 f"indexed={s.get('numberOfNewDocumentsIndexed')} failed={s.get('numberOfDocumentsFailed')}")
            if j["status"] == "FAILED":
                sys.exit(f"✘ ingestion 失敗：{j.get('failureReasons')}")
            if not s.get("numberOfNewDocumentsIndexed"):
                sys.exit("✘ ingestion 完成但 indexed=0——空索引，檢索會永遠回空。檢查語料格式與 prefix。")
            ok("ingestion 完成")
            return
    sys.exit("✘ ingestion 等待逾時，請用 get-ingestion-job 自行確認")


def smoke(region, kb_id):
    r = aws("bedrock-agent-runtime", "retrieve", "--knowledge-base-id", kb_id,
            "--retrieval-query", "text=投資詐騙有哪些常見警訊？",
            "--retrieval-configuration",
            "vectorSearchConfiguration={numberOfResults=3}", region=region, check=False)
    hits = (r or {}).get("retrievalResults", [])
    if not hits:
        print("  ✘ 檢索回空——KB 建好了但檢索不到東西，F3 仍會失敗")
        return False
    ok(f"檢索測試通過，取回 {len(hits)} 段")
    for h in hits[:2]:
        src = ((h.get("location") or {}).get("s3Location") or {}).get("uri", "?")
        info(f"· {(h.get('content') or {}).get('text','')[:60]}…  出處 {src}")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default=os.environ.get("AWS_REGION", REGION_DEFAULT))
    ap.add_argument("--corpus", help="語料檔路徑（repo 以外）")
    ap.add_argument("--check", action="store_true", help="只檢查現況，不建立任何東西")
    ap.add_argument("--reingest", action="store_true", help="資源已存在，只重跑 ingestion")
    a = ap.parse_args()

    ident = aws("sts", "get-caller-identity")
    account, region = ident["Account"], a.region
    step(f"環境：帳號 {account}／{region}")

    if a.check:
        kb_id = find_kb(region)
        if kb_id:
            ok(f"本帳號已有 {KB_NAME}：{kb_id}")
            smoke(region, kb_id)
            print(f"\n部署時帶：--parameter-overrides KnowledgeBaseId={kb_id}")
        else:
            print(f"  ✘ 本帳號／region 沒有 {KB_NAME}。KB ID 是帳號＋region 範圍資源，"
                  f"別的帳號的 ID 在這裡一定不能用。\n"
                  f"  跑：python3 scripts/setup_rag_kb.py --corpus <語料檔路徑>")
        return

    step("① 語料 bucket")
    corpus_bucket = ensure_corpus_bucket(account, region)
    step("② S3 Vectors")
    index_arn = ensure_vector_index(region)
    step("③ IAM role")
    role_arn = ensure_role(account, region, corpus_bucket, index_arn)
    step("④ Knowledge Base")
    kb_id = ensure_kb(region, role_arn, index_arn)
    step("⑤ Data source")
    ds_id = ensure_data_source(region, kb_id, corpus_bucket, account)

    if a.corpus:
        step("⑥ 上傳語料")
        upload_corpus(a.corpus, corpus_bucket, region)
    if a.corpus or a.reingest:
        step("⑦ Ingestion")
        ingest(region, kb_id, ds_id)
        step("⑧ 檢索煙測")
        smoke(region, kb_id)
    else:
        print("\n  ⚠ 沒有指定 --corpus，KB 目前是空的（檢索會回空、F3 仍會失敗）。")
        print("    拿到語料後跑：python3 scripts/setup_rag_kb.py --corpus <路徑>")

    print(f"""
════════════════════════════════════════════════════════
KB_ID = {kb_id}

接下來：
  1. cd {REPO_ROOT} && npm run build:sam
  2. sam deploy --template-file .aws-sam/build/template.yaml --stack-name maimate \\
       --region {region} --capabilities CAPABILITY_IAM --resolve-s3 \\
       --parameter-overrides KnowledgeBaseId={kb_id} \\
       --no-confirm-changeset --no-fail-on-empty-changeset
  3. python3 scripts/verify_live.py --only F     # F3 應該轉綠
════════════════════════════════════════════════════════""")


if __name__ == "__main__":
    main()
