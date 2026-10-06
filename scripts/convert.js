const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

function obfuscate(source) {
    new vm.Script(source);
    const bytes = Buffer.from(source, "utf8");
    const chunks = [];
    for (let offset = 0; offset < bytes.length;) {
        const length = Math.min(crypto.randomInt(64, 193), bytes.length - offset);
        const seed = crypto.randomBytes(4).readUInt32LE(0) || 1;
        let state = seed;
        const encoded = Buffer.alloc(length);
        for (let i = 0; i < length; i++) {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            encoded[length - 1 - i] = ((bytes[offset + i] + i) & 255) ^ (state & 255);
        }
        chunks.push([offset, seed, encoded.toString("base64")]);
        offset += length;
    }
    for (let i = chunks.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [chunks[i], chunks[j]] = [chunks[j], chunks[i]];
    }

    // 随机变量名；解码同步执行，保持原脚本的直接 eval 执行方式。
    const names = Array.from({ length: 8 }, () => "_" + crypto.randomBytes(8).toString("hex"));
    const [data, buffer, chunk, state, text, index, value, decoded] = names;
    const decoder = `(()=>{const ${data}=${JSON.stringify(chunks)},${buffer}=new Uint8Array(${bytes.length});for(const ${chunk} of ${data}){let ${state}=${chunk}[1];const ${text}=atob(${chunk}[2]);for(let ${index}=0;${index}<${text}.length;${index}++){${state}^=${state}<<13;${state}^=${state}>>>17;${state}^=${state}<<5;const ${value}=${text}.charCodeAt(${text}.length-1-${index})^(${state}&255);${buffer}[${chunk}[0]+${index}]=(${value}-${index})&255;}}const ${decoded}=new TextDecoder().decode(${buffer});return ${decoded};})()`;

    // 写入前验证字节解码完全一致；不会执行原始业务代码。
    const restored = vm.runInNewContext(decoder, {
        Uint8Array,
        TextDecoder,
        atob: value => Buffer.from(value, "base64").toString("binary"),
    });
    if (restored !== source) {
        throw new Error("混淆结果校验失败，未写入输出文件。");
    }

    // 生成浏览器可直接执行的 JS
    return `eval(${decoder});`;

}
module.exports = { obfuscate };

if (require.main === module) {
    const input = process.argv[2];
    if (input && path.resolve(input) === path.join(__dirname, 'jump.js')) {
      if (process.argv[3]) process.env.JUMP_OUTPUT = path.resolve(process.argv[3]);
      require('./build.js');
    } else {
    if (!input) {
        console.error("用法: node scripts/convert.js <input.js> [output.js]");
        process.exit(1);
    }

    if (!fs.existsSync(input)) {
        console.error(`文件不存在: ${input}`);
        process.exit(1);
    }

    const output =
        process.argv[3] ||
        path.join(
            path.dirname(input),
            path.basename(input, path.extname(input)) + ".base64.js"
        );

    if (path.resolve(input) === path.resolve(output)) {
        console.error("输出文件不能覆盖原始文件。");
        process.exit(1);
    }

    // 仅检查语法，不在转换时执行输入脚本。
    const source = fs.readFileSync(input, "utf8");
    new vm.Script(source, { filename: input });

    // 启动动画素材校验：配置里写了 video 却在发布目录里找不到文件，构建直接失败。
    // 宁可构建红掉，也不要在线上被抽中时才发现动画放不出来。
    const assetsDir = path.join(__dirname, "..", "pages");
    const referenced = new Set(
        [...source.matchAll(/(?:video|src|VIDEO)\s*[:=]\s*['"]([^'"]+\.(?:mp4|webm|mov|m4v))['"]/gi)]
            .map((match) => match[1])
    );
    const missing = [];
    for (const ref of referenced) {
        const file = path.resolve(assetsDir, ref.replace(/^\.?\//, ""));
        if (!file.startsWith(path.resolve(assetsDir))) {
            console.error(`启动动画路径越界（必须放在 pages 目录内）: ${ref}`);
            process.exit(1);
        }
        if (!fs.existsSync(file)) missing.push({ ref, file });
    }
    if (missing.length) {
        console.error("启动动画素材缺失，构建中止：");
        for (const item of missing) console.error(`  ${item.ref}  ->  找不到 ${item.file}`);
        process.exit(1);
    }
    if (referenced.size) {
        console.log(`启动动画素材校验通过（${referenced.size} 个引用）`);
    }


    const result = obfuscate(source);
    fs.writeFileSync(output, result, 'utf8');
    console.log('完成');
    console.log(input + ' -> ' + output);
    console.log('原始大小: ' + Buffer.byteLength(source) + ' bytes');
    console.log('编码后大小: ' + Buffer.byteLength(result) + ' bytes');
    }
}
