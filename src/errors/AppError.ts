/**
 * Error carrying an HTTP status code, used for failures that are expected and
 * safe to surface to the client. `globalErrorHandler` echoes its message
 * verbatim; anything not an AppError becomes a generic 500.
 */
export class AppError extends Error {
	public statusCode: number;

	constructor(message: string, statusCode: number) {
		super(message);

		this.statusCode = statusCode;
		Object.setPrototypeOf(this, AppError.prototype);
	}
}
