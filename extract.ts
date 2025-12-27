import { readdirSync, readFileSync, writeFileSync } from 'fs';

const gparamsDir = 'gparams';
interface LightAngleSrc {
    title: string;
    angle0: {
        id: number;
        value: {
            x: number;
            y: number;
        };
        unkFloat: number;
    }[];
}

interface LightAnglePath {
    title?: string;
    [id: number]: {
        [time: number]: {
            x: number;
            y: number;
        };
    };
}

const lightAnglePaths: Record<string, LightAnglePath> = {};

const files = readdirSync(gparamsDir);

for (const file of files) {
    let name = file.replace('.json', '');
    let content = readFileSync(`./${gparamsDir}/${file}`);
    let json = JSON.parse(content.toString());
    if (json['groups']) {
        let group1 = json['groups'][0];
        if (group1['params']) {
            let param1 = group1['params'][0];
            if (param1 && param1['name1'] && param1['name1'] == 'Directional Light Angle0') {
                let angles: LightAngleSrc['angle0'] = param1['values'];
                const path: LightAnglePath = {};
                for (const angle of angles) {
                    if (!path[angle.id]) {
                        path[angle.id] = {};
                    }
                    path[angle.id][angle.unkFloat] = {
                        x: angle.value.x,
                        y: angle.value.y,
                    };
                }
                path['title'] = name;
                lightAnglePaths[name] = path;
            }
        }
    }
}

const output = JSON.stringify(lightAnglePaths);
writeFileSync('light-angles.json', output);
