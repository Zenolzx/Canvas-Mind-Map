const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const read=name=>JSON.parse(fs.readFileSync(name,'utf8'));
const manifest=read('manifest.json'),pkg=read('package.json'),lock=read('package-lock.json'),versions=read('versions.json');
assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
assert.equal(pkg.version,manifest.version,'package version differs');
assert.equal(lock.version,manifest.version,'lockfile version differs');
assert.equal(lock.packages[''].version,manifest.version,'root package lock version differs');
assert.equal(versions[manifest.version],manifest.minAppVersion,'versions.json differs');
assert.ok(fs.existsSync(`docs/release-${manifest.version}.md`),'release notes missing');
const target=path.resolve('dist',manifest.version);fs.mkdirSync(target,{recursive:true});
const sums=[];
for(const name of ['main.js','manifest.json','styles.css']){
 assert.ok(fs.statSync(name).size>0,`${name} is empty`);
 fs.copyFileSync(name,path.join(target,name));
 sums.push(crypto.createHash('sha256').update(fs.readFileSync(path.join(target,name))).digest('hex')+'  '+name);
}
fs.writeFileSync(path.join(target,'SHA256SUMS.txt'),sums.join('\n')+'\n');
console.log(`Release ${manifest.version} staged at ${target}. Upload the three plugin files individually; SHA256SUMS.txt is optional. Nothing was published.`);
