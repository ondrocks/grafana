import oboe from 'oboe';

// See: https://github.com/microsoft/TypeScript/issues/20595#issuecomment-587297818
const postMessage = ((self as unknown) as Worker).postMessage;

export type StreamJSONResponsePayload = {
  data: {
    url: string;
    chunkSize?: number;
    hasObjectResponse?: boolean;
    headers?: any;
    limit?: number;
    path?: string;
    withCredentials?: boolean;
  };
};

export interface StreamJSONResponseWorker extends Worker {
  postMessage(message: StreamJSONResponsePayload['data'], transfer: Transferable[]): void;
  postMessage(message: StreamJSONResponsePayload['data'], options?: PostMessageOptions): void;
}

let isFetching = false;
export function streamJSONResponse(data: StreamJSONResponsePayload['data'], callback: (arg: any) => void) {
  // Node.js doesn't support instantiation via web worker, so checking for whether this
  // instance is already fetching wouldn't work during tests.
  if (isFetching && !(process.env.NODE_ENV === 'test')) {
    throw new Error('Worker is already fetching data!');
  }
  isFetching = true;

  const {
    url,
    hasObjectResponse = false,
    headers = {},
    chunkSize = Number.MAX_SAFE_INTEGER,
    limit = Number.MAX_SAFE_INTEGER,
    path = 'data.*',
    withCredentials = false,
  } = data;
  let nodes: any = hasObjectResponse ? {} : [];
  let numNodes = 0;

  // Important to use oboe 2.1.4!! 2.1.5 can't be used in web workers!
  oboe({ url, headers, withCredentials })
    .node(path, function(this: oboe.Oboe, node, _path) {
      numNodes++;

      if (hasObjectResponse) {
        nodes[_path[_path.length - 1]] = node;
      } else {
        nodes.push(node);
      }

      if (nodes.length % chunkSize === 0) {
        callback(nodes);
        nodes = hasObjectResponse ? {} : [];
      }

      if (numNodes >= limit) {
        if (nodes.length > 0) {
          callback(nodes);
        }
        this.abort();
        callback('DONE');
        return oboe.drop;
      }

      // Since we stream chunks, we don't need oboe to build an object.
      // Reduces RAM use dramatically!
      return oboe.drop;
    })
    .fail(error => {
      // If e.g. 405 happens, oboe will trigger this twice. Once with
      // the request failure error and once with its own error about not
      // being able to parse the response.
      if (error.statusCode) {
        throw error;
      }
    })
    .done(() => {
      if (nodes.length > 0) {
        callback(nodes);
      }
      callback('DONE');
    });
}

self.onmessage = function({ data }: StreamJSONResponsePayload) {
  streamJSONResponse(data, postMessage);
};

export default function dummyRequiredForJestMockImplementationToWork() {}
