export interface RespuestaCapSolver {
    errorId: number;
    errorCode?: string;
    errorDescription?: string;
    status?: string;
    solution?: {
        text?: string;
    };
}
