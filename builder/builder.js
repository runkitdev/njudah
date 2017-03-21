
const path = require("path");

const I = require("immutable");

const { lstat, readdir } = require("@njudah/fast-fs");

const getChecksum = require("@njudah/get-checksum");
const getFileChecksum = require("./get-file-checksum");

const { transform, find: findTransform } = require("./transform");
const { refine, deref, set, exists } = require("@njudah/cursor");

const copy = require("./copy");
const mkdir = require("./mkdir");

const id = x => x;
const toMatcher = require("./to-matcher");

module.exports = Build;
module.exports.build = Build;
module.exports.transform = transform;
var total = 0 ;
function Build({ path: source, destination, state, children = [], ignore })
{
    const checksum = refine(state, "checksum");
    const checksumValue = deref(checksum, false);

    const cachePath = path.join(destination, "cache");
    const productPath = checksumValue && path.join(destination, checksumValue, path.extname(source));
    const mergedIgnore = toMatcher.memoizedCall(refine(state, "ignore"), ignore, destination, "**/.*");

    const transforms = transform.optimize.await(refine(state, "optimize"), children);

    return <Item    source = { source }
                    state = { refine(state, "item") }
                    transforms = { transforms }
                    checksum = { checksum }
                    ignore = { mergedIgnore }
                    cache = { mkdir.p.await(refine(state, "cache"), cachePath) }
                    destination = { productPath && mkdir.p.await(refine(state, "product"), productPath) } />;
}


function Item({ source, state, ignore, checksum, ...rest })
{
    if (deref(checksum, "") === "ignored" || ignore(source))
        return set(checksum, "ignored");

    const stat = lstat.await(refine(state, "file-description"), source);

    if (typeof stat !== "number")
        return;

    const Type = stat === 1 ? Directory : File;

    return <Type
                source = { source }
                ignore = { ignore }
                checksum = { checksum }
                { ...rest }
                state = { refine(state, "type") } />;
}

function File({ source, cache, checksum, transforms, state, destination })
{
    if (!exists(state))
        set(state, I.Map());

    const fileChecksum = getFileChecksum.await(refine(state, "file-checksum"), source);

    if (!fileChecksum)
        return;

    const { transform, checksum: transformChecksum } = findTransform(source, transforms) || { };
    const checksumValue = set(checksum, getChecksum(JSON.stringify({ transformChecksum, fileChecksum })));

    const artifactPath = transform ? path.join(cache, checksumValue + path.extname(source)) : source;
    const transformed = !transform || transform.await(refine(state, "transformed"), { source, destination: artifactPath });

    return  transformed && destination &&
            <copy.result
                state = { refine(state, "copy") }
                source = { artifactPath }
                destination = { destination } />;
}

function Directory({ source, destination, cache, checksum, transforms, ignore, state })
{
    const files = readdir.await(refine(state, "children"), source);

    if (!files || !transforms)
        return <id/>;

    const hasChecksum = files.every(aPath => deref.in(state, aPath + "-checksum", false));
    const checksumValue = set(checksum, hasChecksum &&
        getChecksum(...files.map(aPath => deref.in(state, aPath + "-checksum", false))));
    const completed = destination && mkdir.await(refine(state, "mkdir"), { destination });

    return  <id path = { source } checksum = { checksumValue } >
            {
                files.map(aPath =>
                        <Item
                            source = { aPath }
                            ignore = { ignore }
                            checksum = { refine(state, aPath + "-checksum") }
                            transforms = { transforms } 
                            state = { refine(state, aPath) }
                            cache = { cache }
                            destination = { completed && path.join(destination, path.basename(aPath)) } />)
            }
            </id>
}

