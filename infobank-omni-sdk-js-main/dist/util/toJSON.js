// flatted 사용
import { stringify } from 'flatted';
export function toJSON(json) {
    return stringify(json);
}
